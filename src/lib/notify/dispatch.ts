import "server-only";

// ---------------------------------------------------------------------------
// Slack DM dispatcher for notification_delivery (cron: /api/notify/dispatch).
//
//   1. A row stuck in `sending` (crash mid-send) is failed — it may have been
//      delivered, so it is never resent.
//   2. Each pending row is re-checked at send time (login active, person still
//      employee/contractor, Slack link still connected, DM gate open), then
//      claimed pending → sending before Slack is called, so two overlapping
//      runs can't both send it.
//   3. Slack rate limits are retried with backoff (bounded); anything else fails.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { sendSlackDirectMessage } from "@/lib/slack/client";
import { appBaseUrl } from "@/lib/shared/app-url";
import { todayInWorkTz } from "@/lib/worklist/dates";
import { recordCronRun } from "@/lib/admin/cron-run";
import { connectedSlackUserFor } from "./publish";
import {
  buildDmText,
  dmGate,
  retryDecision,
  DM_STALE_AFTER_MS,
  DM_STUCK_AFTER_MS,
} from "./rules";

export const NOTIFY_DISPATCH_AGENT_KEY = "notification_dispatch";
const BATCH = 50;

export interface DispatchCounts {
  sent: number;
  failed: number;
  skipped: number;
  retrying: number;
  stuck: number;
}

export interface DispatchResult {
  ok: boolean;
  counts: DispatchCounts;
  error?: string;
}

interface PendingRow {
  id: string;
  slack_user_id: string | null;
  attempts: number;
  notification: {
    recipient_user_id: string;
    title: string;
    body: string | null;
    href: string | null;
    created_at: string;
  } | null;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function dispatchPendingDeliveries(
  options: { trigger?: "scheduled" | "manual"; triggeredBy?: string | null } = {},
): Promise<DispatchResult> {
  const admin = createAdminClient();
  const counts: DispatchCounts = { sent: 0, failed: 0, skipped: 0, retrying: 0, stuck: 0 };
  const startedAt = new Date();
  let error: string | undefined;

  try {
    const stuckBefore = new Date(Date.now() - DM_STUCK_AFTER_MS).toISOString();
    const { data: stuck } = await admin
      .from("notification_delivery")
      .update({
        status: "failed",
        last_error: "Interrupted while sending — it may have been delivered, so it was not resent.",
      })
      .eq("status", "sending")
      .lt("updated_at", stuckBefore)
      .select("id");
    counts.stuck = stuck?.length ?? 0;

    const { data, error: loadError } = await admin
      .from("notification_delivery")
      .select(
        "id, slack_user_id, attempts, notification:notification_id (recipient_user_id, title, body, href, created_at)",
      )
      .eq("status", "pending")
      .eq("channel", "slack_dm")
      .lte("next_attempt_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(BATCH);
    if (loadError) throw new Error(loadError.message);

    const env = { live: process.env.SLACK_DM_LIVE, testIds: process.env.SLACK_DM_TEST_USER_IDS };
    const baseUrl = appBaseUrl();

    for (const raw of (data ?? []) as unknown as PendingRow[]) {
      const n = one(raw.notification);
      const skip = async (reason: string) => {
        await admin
          .from("notification_delivery")
          .update({ status: "skipped", last_error: reason })
          .eq("id", raw.id)
          .eq("status", "pending");
        counts.skipped++;
      };

      if (!n) {
        await skip("Notification no longer exists.");
        continue;
      }
      if (Date.now() - new Date(n.created_at).getTime() > DM_STALE_AFTER_MS) {
        await skip("Older than 24 hours — not sent late.");
        continue;
      }
      const slackUserId = await connectedSlackUserFor(n.recipient_user_id);
      if (!slackUserId || slackUserId !== raw.slack_user_id) {
        await skip("Recipient can no longer be messaged in Slack (login, employment or Slack link changed).");
        continue;
      }
      const gate = dmGate(env, slackUserId);
      if (!gate.send) {
        await skip(gate.reason);
        continue;
      }

      const attempts = raw.attempts + 1;
      const { data: claimed } = await admin
        .from("notification_delivery")
        .update({ status: "sending", attempts })
        .eq("id", raw.id)
        .eq("status", "pending")
        .select("id");
      if (!claimed?.length) continue;

      const res = await sendSlackDirectMessage(slackUserId, buildDmText(n, baseUrl));
      if (res.ok) {
        await admin
          .from("notification_delivery")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            slack_channel_id: res.channel,
            slack_ts: res.ts,
            last_error: null,
          })
          .eq("id", raw.id);
        counts.sent++;
        continue;
      }

      const decision = retryDecision(res.code, attempts, res.retryAfterSec);
      await admin
        .from("notification_delivery")
        .update(
          decision.status === "pending"
            ? {
                status: "pending",
                next_attempt_at: new Date(Date.now() + decision.delayMs).toISOString(),
                last_error: res.error,
              }
            : { status: "failed", last_error: res.error },
        )
        .eq("id", raw.id);
      if (decision.status === "pending") counts.retrying++;
      else counts.failed++;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const processed = counts.sent + counts.failed + counts.skipped + counts.retrying + counts.stuck;
  if (processed > 0 || error) await recordRun(options, startedAt, counts, processed, error);
  else await recordCronRun(NOTIFY_DISPATCH_AGENT_KEY, startedAt, { ok: true });
  return { ok: !error, counts, error };
}

async function recordRun(
  options: { trigger?: "scheduled" | "manual"; triggeredBy?: string | null },
  startedAt: Date,
  counts: DispatchCounts,
  processed: number,
  error: string | undefined,
) {
  try {
    const admin = createAdminClient();
    const { data: agent } = await admin
      .from("agent")
      .select("id")
      .eq("key", NOTIFY_DISPATCH_AGENT_KEY)
      .maybeSingle();
    const agentId = (agent as { id: string } | null)?.id;
    if (!agentId) return;
    const finishedAt = new Date();
    const status = error || counts.failed > 0 ? "error" : "success";
    await admin.from("agent_run").insert({
      agent_id: agentId,
      trigger: options.trigger ?? "scheduled",
      status,
      target_date: todayInWorkTz(),
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      records_processed: processed,
      records_new: counts.sent,
      triggered_by: options.triggeredBy ?? null,
      triggered_by_email: options.trigger === "manual" ? null : "system:cron",
      error: error ?? (counts.failed > 0 ? `${counts.failed} Slack DM(s) failed — see notification_delivery.last_error.` : null),
      detail: counts,
    });
    await admin
      .from("agent")
      .update({ last_run_at: finishedAt.toISOString(), last_status: status })
      .eq("id", agentId);
  } catch {
    // run bookkeeping is best-effort
  }
}
