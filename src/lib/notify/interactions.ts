import "server-only";

// ---------------------------------------------------------------------------
// Slack → Ops: button clicks on notification cards (/api/slack/interactions).
//
// Each click is: verified (route) → recorded in notification_action (unique
// request key, so Slack's retries are no-ops) → the clicker's Slack id is
// mapped to a connected, active employee and their Ops login → authorized
// (interaction-rules.ts) → applied through the same code paths Ops uses →
// audited → the clicker gets an ephemeral reply, and cards are updated.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/auth/session";
import type { AppUser } from "@/lib/auth/permissions";
import { updateSlackMessage } from "@/lib/slack/client";
import { appBaseUrl } from "@/lib/shared/app-url";
import { setOpsTaskStatus } from "@/lib/worklist/tasks";
import { notifyTimeOffDecided } from "./events/schedule";
import { authorizeAction, type ParsedInteraction } from "./interaction-rules";
import { buildCardBlocks, fallbackText, parseStoredCard } from "./slack-blocks";
import type { NotifyActionId } from "./types";

type Outcome = "applied" | "already_done" | "forbidden" | "not_found" | "error";

interface DeliveryRow {
  id: string;
  event_id: string | null;
  channel: "slack_dm" | "slack_channel";
  slack_user_id: string | null;
  slack_channel_id: string | null;
  slack_ts: string | null;
  message_key: string | null;
  blocks: unknown;
  event: { subject_type: string | null; subject_id: string | null } | { subject_type: string | null; subject_id: string | null }[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const APP_USER_COLUMNS =
  "id, email, full_name, title, role, is_active, module_access, notes, person_id, last_seen_at, created_at, updated_at";

/** The active employee + Ops login behind a connected Slack account. */
async function loginForSlackUser(slackUserId: string): Promise<{ personId: string | null; login: AppUser | null }> {
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("person_slack_link")
    .select("person_id")
    .eq("slack_user_id", slackUserId)
    .eq("status", "connected")
    .maybeSingle();
  const personId = (link as { person_id: string } | null)?.person_id ?? null;
  if (!personId) return { personId: null, login: null };
  const [{ data: person }, { data: logins }] = await Promise.all([
    admin.from("person").select("status").eq("id", personId).maybeSingle(),
    admin.from("app_user").select(APP_USER_COLUMNS).eq("person_id", personId).eq("is_active", true).limit(1),
  ]);
  const status = (person as { status: string } | null)?.status;
  if (status !== "employee" && status !== "contractor") return { personId: null, login: null };
  return { personId, login: ((logins as AppUser[] | null) ?? [])[0] ?? null };
}

async function reply(responseUrl: string | null, text: string) {
  if (!responseUrl) return;
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // the action itself is recorded; the confirmation is best-effort
  }
}

export async function handleSlackAction(parsed: ParsedInteraction): Promise<void> {
  if (parsed.actionId === "link" || !parsed.deliveryId) return;
  const action = parsed.actionId as NotifyActionId;
  const admin = createAdminClient();
  const requestKey = `${parsed.slackUserId}:${parsed.actionTs}:${action}:${parsed.deliveryId}`.slice(0, 200);

  const { data: delivery } = await admin
    .from("notification_delivery")
    .select("id, event_id, channel, slack_user_id, slack_channel_id, slack_ts, message_key, blocks, event:event_id (subject_type, subject_id)")
    .eq("id", parsed.deliveryId)
    .maybeSingle();
  const d = delivery as DeliveryRow | null;
  const ev = one(d?.event ?? null);

  const { data: logged, error: logError } = await admin
    .from("notification_action")
    .insert({
      delivery_id: d?.id ?? null,
      event_id: d?.event_id ?? null,
      action,
      subject_type: ev?.subject_type ?? null,
      subject_id: ev?.subject_id ?? null,
      slack_user_id: parsed.slackUserId,
      request_key: requestKey,
    })
    .select("id")
    .single();
  if (logError) {
    // 23505: Slack retried a click we already handled.
    if (logError.code !== "23505") console.error(`[slack-action] log failed: ${logError.message}`);
    return;
  }
  const actionId = (logged as { id: string }).id;
  const finish = async (outcome: Outcome, detail: string, actorUserId: string | null = null) => {
    await admin
      .from("notification_action")
      .update({ outcome, detail: detail.slice(0, 500), actor_user_id: actorUserId })
      .eq("id", actionId);
    await reply(parsed.responseUrl, detail);
  };

  if (!d) return finish("not_found", "That notification no longer exists.");
  const { login } = await loginForSlackUser(parsed.slackUserId);
  const decision = authorizeAction({ action, delivery: d, clickerSlackId: parsed.slackUserId, login });
  if (!decision.ok) return finish("forbidden", decision.reason, login?.id ?? null);

  try {
    if (action === "pto.approve" || action === "pto.deny") {
      return await decideTimeOff(admin, d, ev?.subject_id ?? null, action, login!, finish);
    }
    if (action === "task.complete") {
      return await completeTask(d, login!, finish);
    }
    return await acknowledge(admin, d, login, parsed.slackUserId, finish);
  } catch (err) {
    return finish("error", `Something went wrong: ${err instanceof Error ? err.message : String(err)}`, login?.id ?? null);
  }
}

type Finish = (outcome: Outcome, detail: string, actorUserId?: string | null) => Promise<void>;

async function decideTimeOff(
  admin: ReturnType<typeof createAdminClient>,
  d: DeliveryRow,
  subjectId: string | null,
  action: "pto.approve" | "pto.deny",
  login: AppUser,
  finish: Finish,
) {
  const timeOffId = subjectId ?? d.message_key?.replace(/^pto:/, "") ?? null;
  if (!timeOffId) return finish("not_found", "Couldn't find that time-off request.", login.id);
  const status = action === "pto.approve" ? "approved" : "denied";
  const name = login.full_name?.trim() || login.email;

  // Only a still-pending request can be decided — a second click (or someone
  // else deciding first) changes nothing.
  const { data: updated, error } = await admin
    .from("person_time_off")
    .update({ status, reviewed_by: login.id, reviewed_at: new Date().toISOString() })
    .eq("id", timeOffId)
    .eq("status", "requested")
    .select("id, person_id, start_date, end_date");
  if (error) return finish("error", `Couldn't update the request: ${error.message}`, login.id);
  if (!updated?.length) {
    const { data: current } = await admin.from("person_time_off").select("status").eq("id", timeOffId).maybeSingle();
    const s = (current as { status: string } | null)?.status;
    return finish(
      s ? "already_done" : "not_found",
      s ? `This request is already ${s === "requested" ? "pending" : s}.` : "That request no longer exists.",
      login.id,
    );
  }
  const row = updated[0] as { person_id: string; start_date: string; end_date: string };
  await recordAudit({
    actorId: login.id,
    actorEmail: login.email,
    action: `time_off.${status === "approved" ? "approve" : "deny"}`,
    entity: "person_time_off",
    entityId: timeOffId,
    summary: `${status === "approved" ? "Approved" : "Denied"} time off ${row.start_date}–${row.end_date} from Slack`,
    metadata: { via: "slack", person_id: row.person_id },
  });
  await notifyTimeOffDecided({ timeOffId, status, reviewerName: name, actorUserId: login.id });
  return finish("applied", `${status === "approved" ? "✅ Approved" : "❌ Denied"}. The employee has been told.`, login.id);
}

async function completeTask(d: DeliveryRow, login: AppUser, finish: Finish) {
  const taskId = d.message_key?.startsWith("task:") ? d.message_key.slice(5) : null;
  if (!taskId) return finish("not_found", "Couldn't find that task.", login.id);
  const res = await setOpsTaskStatus({ authId: login.id, email: login.email, appUser: login }, taskId, "done");
  // setOpsTaskStatus also updates the task's Slack cards.
  if (!res.ok) return finish("forbidden", res.error, login.id);
  return finish("applied", "✅ Task marked complete.", login.id);
}

async function acknowledge(
  admin: ReturnType<typeof createAdminClient>,
  d: DeliveryRow,
  login: AppUser | null,
  slackUserId: string,
  finish: Finish,
) {
  const { data: claimed } = await admin
    .from("notification_delivery")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: login?.id ?? null })
    .eq("id", d.id)
    .is("acknowledged_at", null)
    .select("id");
  if (!claimed?.length) return finish("already_done", "Already acknowledged.", login?.id ?? null);

  const who = login?.full_name?.trim() || "the recipient";
  const note = `👍 Acknowledged by ${who}`;
  await admin.from("notification_delivery").update({ resolved_note: note }).eq("id", d.id);
  const card = parseStoredCard(d.blocks);
  if (card && d.slack_channel_id && d.slack_ts) {
    await updateSlackMessage(
      d.slack_channel_id,
      d.slack_ts,
      fallbackText(card.msg),
      buildCardBlocks(card, { baseUrl: appBaseUrl(), deliveryId: d.id, showActions: false, resolvedNote: note }),
    );
  }
  return finish("applied", "👍 Acknowledged.", login?.id ?? null);
}
