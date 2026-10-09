import "server-only";

// ---------------------------------------------------------------------------
// publishNotification — the one way Ops notifies a user.
//
// Writes the in-app notification, and when `slack` is set also queues a Slack
// DM delivery for /api/notify/dispatch. Never throws: a notification failing
// must not fail the action that caused it.
//
// Do not put compensation, HR-file content or candidate personal details in
// title/body — DMs leave the app. Link to the record instead.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import type { ModuleKey } from "@/lib/auth/permissions";
import { isSafeWorkLink } from "@/lib/worklist/items";

export interface PublishNotificationInput {
  recipientUserId: string;
  /** Dotted event name, e.g. "task.assigned". */
  kind: string;
  title: string;
  body?: string | null;
  href?: string | null;
  module?: ModuleKey | null;
  severity?: "info" | "action" | "warning";
  actorUserId?: string | null;
  taskId?: string | null;
  /** Same key for the same recipient = one notification, however often published. */
  dedupeKey?: string | null;
  /** Also DM the recipient in Slack (if their Slack account is connected). */
  slack?: boolean;
}

export type PublishResult =
  | { ok: true; id: string; duplicate: boolean; slack: "queued" | "no_link" | "not_requested" }
  | { ok: false; error: string };

const KIND = /^[a-z_]+(\.[a-z_]+)*$/;

export async function publishNotification(input: PublishNotificationInput): Promise<PublishResult> {
  try {
    if (!KIND.test(input.kind)) return { ok: false, error: `Bad notification kind "${input.kind}".` };
    const title = input.title.trim().slice(0, 200);
    if (!title) return { ok: false, error: "Notification needs a title." };
    const href = input.href ?? null;
    if (!isSafeWorkLink(href)) return { ok: false, error: "Notification link must be an app path or Slack URL." };

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("user_notification")
      .insert({
        recipient_user_id: input.recipientUserId,
        kind: input.kind,
        title,
        body: input.body?.trim().slice(0, 2000) || null,
        href,
        module: input.module ?? null,
        severity: input.severity ?? "info",
        actor_user_id: input.actorUserId ?? null,
        task_id: input.taskId ?? null,
        dedupe_key: input.dedupeKey ?? null,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505" && input.dedupeKey) {
        const { data: existing } = await admin
          .from("user_notification")
          .select("id")
          .eq("recipient_user_id", input.recipientUserId)
          .eq("dedupe_key", input.dedupeKey)
          .maybeSingle();
        return {
          ok: true,
          id: (existing as { id: string } | null)?.id ?? "",
          duplicate: true,
          slack: "not_requested",
        };
      }
      return { ok: false, error: error.message };
    }

    const id = (data as { id: string }).id;
    if (!input.slack) return { ok: true, id, duplicate: false, slack: "not_requested" };

    const slackUserId = await connectedSlackUserFor(input.recipientUserId);
    await admin.from("notification_delivery").insert(
      slackUserId
        ? { notification_id: id, channel: "slack_dm", slack_user_id: slackUserId, status: "pending" }
        : {
            notification_id: id,
            channel: "slack_dm",
            status: "skipped",
            last_error: "No connected Slack account (Admin ▸ Slack).",
          },
    );
    return { ok: true, id, duplicate: false, slack: slackUserId ? "queued" : "no_link" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The Slack user id Ops may DM for this login, or null. Requires an active
 * login, an employee/contractor person, and a `connected` link.
 */
export async function connectedSlackUserFor(appUserId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: user } = await admin
    .from("app_user")
    .select("person_id, is_active")
    .eq("id", appUserId)
    .maybeSingle();
  const u = user as { person_id: string | null; is_active: boolean } | null;
  if (!u?.is_active || !u.person_id) return null;

  const [{ data: person }, { data: link }] = await Promise.all([
    admin.from("person").select("status").eq("id", u.person_id).maybeSingle(),
    admin
      .from("person_slack_link")
      .select("status, slack_user_id")
      .eq("person_id", u.person_id)
      .maybeSingle(),
  ]);
  const status = (person as { status: string } | null)?.status;
  if (status !== "employee" && status !== "contractor") return null;
  const l = link as { status: string; slack_user_id: string | null } | null;
  return l?.status === "connected" && l.slack_user_id ? l.slack_user_id : null;
}
