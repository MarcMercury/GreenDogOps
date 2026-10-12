import "server-only";

// ---------------------------------------------------------------------------
// Slack delivery dispatcher for notification_delivery
// (cron every 5 min: /api/notify/dispatch; also inline right after an event).
//
//   0. (cron/manual only) time-based producers (escalations, event
//      reminders), then any events that weren't processed inline.
//   1. A row stuck in `sending` (crash mid-send) is failed — it may have been
//      delivered, so it is never resent.
//   2. Each due DM is re-checked at send time: person still an active
//      employee/contractor, Slack link unchanged, still allowed to see the
//      content (required_module), DM gate open. Then it is claimed
//      pending → sending before Slack is called, so two overlapping runs can't
//      both send it.
//   3. Batched DMs for the same person go out as one digest message.
//   4. Slack rate limits / server errors are retried with backoff (bounded);
//      anything that may have been delivered is never retried.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { postSlackChannelMessage, sendSlackDirectMessage, type SlackDmResult } from "@/lib/slack/client";
import { appBaseUrl } from "@/lib/shared/app-url";
import { todayInWorkTz } from "@/lib/worklist/dates";
import { recordCronRun } from "@/lib/admin/cron-run";
import { stillAllowed, type DirectoryPerson } from "./audience";
import { loadDirectoryPerson } from "./directory";
import { processPendingEvents } from "./engine";
import { runProducers } from "./producers";
import { connectedSlackUserFor } from "./publish";
import {
  buildDmText,
  dmGate,
  retryDecision,
  DM_STALE_AFTER_MS,
  DM_STUCK_AFTER_MS,
} from "./rules";
import {
  buildCardBlocks,
  buildDigestBlocks,
  fallbackText,
  parseStoredCard,
  type StoredCard,
} from "./slack-blocks";

export const NOTIFY_DISPATCH_AGENT_KEY = "notification_dispatch";
const BATCH = 100;

export interface DispatchCounts {
  sent: number;
  failed: number;
  skipped: number;
  retrying: number;
  stuck: number;
  /** Events processed by the safety net. */
  events: number;
  /** Escalations / reminders created this run. */
  produced: number;
}

export interface DispatchResult {
  ok: boolean;
  counts: DispatchCounts;
  error?: string;
}

export interface DispatchOptions {
  trigger?: "scheduled" | "manual" | "event";
  triggeredBy?: string | null;
  /** Only this event's immediate (non-batched) deliveries. */
  eventId?: string;
  /** Only these deliveries (admin retry / test). */
  deliveryIds?: string[];
}

interface PendingRow {
  id: string;
  channel: "slack_dm" | "slack_channel";
  slack_user_id: string | null;
  slack_channel_id: string | null;
  attempts: number;
  recipient_person_id: string | null;
  required_module: string | null;
  title: string | null;
  body: string | null;
  href: string | null;
  blocks: unknown;
  batched: boolean;
  resolved_note: string | null;
  next_attempt_at: string;
  created_at: string;
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

function emptyCounts(): DispatchCounts {
  return { sent: 0, failed: 0, skipped: 0, retrying: 0, stuck: 0, events: 0, produced: 0 };
}

export async function dispatchPendingDeliveries(options: DispatchOptions = {}): Promise<DispatchResult> {
  const admin = createAdminClient();
  const counts = emptyCounts();
  const startedAt = new Date();
  const trigger = options.trigger ?? "scheduled";
  let error: string | undefined;

  try {
    if (trigger !== "event" && !options.deliveryIds?.length) {
      counts.produced = await runProducers();
      counts.events = await processPendingEvents();
    }

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

    let query = admin
      .from("notification_delivery")
      .select(
        "id, channel, slack_user_id, slack_channel_id, attempts, recipient_person_id, required_module, title, body, href, blocks, batched, resolved_note, next_attempt_at, created_at, notification:notification_id (recipient_user_id, title, body, href, created_at)",
      )
      .eq("status", "pending")
      .lte("next_attempt_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(BATCH);
    if (options.eventId) query = query.eq("event_id", options.eventId).eq("batched", false);
    if (options.deliveryIds?.length) query = query.in("id", options.deliveryIds);
    const { data, error: loadError } = await query;
    if (loadError) throw new Error(loadError.message);

    const rows = (data ?? []) as unknown as PendingRow[];
    const sender = new Sender(admin, counts);

    // Batched DMs without buttons are grouped per person into one digest.
    const groups = new Map<string, PendingRow[]>();
    const singles: PendingRow[] = [];
    for (const row of rows) {
      const card = parseStoredCard(row.blocks);
      if (row.channel === "slack_dm" && row.batched && row.recipient_person_id && card && card.actions.length === 0) {
        const list = groups.get(row.recipient_person_id) ?? [];
        list.push(row);
        groups.set(row.recipient_person_id, list);
      } else {
        singles.push(row);
      }
    }
    for (const row of singles) await sender.sendOne(row);
    for (const group of groups.values()) {
      if (group.length === 1) await sender.sendOne(group[0]);
      else await sender.sendDigest(group);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (trigger !== "event") {
    const processed =
      counts.sent + counts.failed + counts.skipped + counts.retrying + counts.stuck + counts.events + counts.produced;
    if (processed > 0 || error) await recordRun(options, startedAt, counts, processed, error);
    else await recordCronRun(NOTIFY_DISPATCH_AGENT_KEY, startedAt, { ok: true });
  }
  return { ok: !error, counts, error };
}

const CONTENT_COLUMNS =
  "id, channel, slack_user_id, slack_channel_id, attempts, recipient_person_id, required_module, title, body, href, blocks, batched, resolved_note, next_attempt_at, created_at";

class Sender {
  private people = new Map<string, DirectoryPerson | null>();
  private env = { live: process.env.SLACK_DM_LIVE, testIds: process.env.SLACK_DM_TEST_USER_IDS };
  private baseUrl = appBaseUrl();

  constructor(
    private admin: ReturnType<typeof createAdminClient>,
    private counts: DispatchCounts,
  ) {}

  private async person(id: string): Promise<DirectoryPerson | null> {
    if (!this.people.has(id)) this.people.set(id, await loadDirectoryPerson(id));
    return this.people.get(id) ?? null;
  }

  /** Claimed rows (status = sending) that must not go out after all. */
  private async skip(ids: string[], reason: string) {
    if (!ids.length) return;
    await this.admin
      .from("notification_delivery")
      .update({ status: "skipped", last_error: reason })
      .in("id", ids)
      .eq("status", "sending");
    this.counts.skipped += ids.length;
  }

  private isStale(row: PendingRow): boolean {
    const base = row.batched ? row.next_attempt_at : (one(row.notification)?.created_at ?? row.created_at);
    return Date.now() - new Date(base).getTime() > DM_STALE_AFTER_MS;
  }

  /** Why a DM to this row's recipient must not go out now — or who to send it to. */
  private async dmCheck(row: PendingRow): Promise<{ reason: string } | { slackUserId: string }> {
    if (this.isStale(row)) return { reason: "Older than 24 hours — not sent late." };
    let slackUserId: string | null = null;
    if (row.recipient_person_id) {
      const p = await this.person(row.recipient_person_id);
      if (!p) return { reason: "No longer an active employee or contractor." };
      if (!p.slackUserId || p.slackUserId !== row.slack_user_id) {
        return { reason: "Their Slack link changed or was disconnected." };
      }
      if (!stillAllowed(p.login, row.required_module)) {
        return { reason: "Their Ops access changed — they can no longer see this." };
      }
      slackUserId = p.slackUserId;
    } else {
      const n = one(row.notification);
      if (!n) return { reason: "Notification no longer exists." };
      slackUserId = await connectedSlackUserFor(n.recipient_user_id);
      if (!slackUserId || slackUserId !== row.slack_user_id) {
        return { reason: "Recipient can no longer be messaged in Slack (login, employment or Slack link changed)." };
      }
    }
    const gate = dmGate(this.env, slackUserId);
    if (!gate.send) return { reason: gate.reason };
    return { slackUserId };
  }

  /**
   * pending → sending, returning each row's content AS CLAIMED. A batched
   * update merged into the row (engine.ts coalescing) either landed before
   * the claim and is included here, or finds the row no longer pending and
   * becomes a new delivery — never silently lost.
   */
  private async claim(rows: PendingRow[]): Promise<PendingRow[]> {
    const claimed: PendingRow[] = [];
    for (const row of rows) {
      const { data } = await this.admin
        .from("notification_delivery")
        .update({ status: "sending", attempts: row.attempts + 1 })
        .eq("id", row.id)
        .eq("status", "pending")
        .select(CONTENT_COLUMNS);
      const fresh = (data as unknown as Omit<PendingRow, "notification">[] | null)?.[0];
      if (fresh) claimed.push({ ...fresh, attempts: row.attempts, notification: row.notification });
    }
    return claimed;
  }

  private async record(rows: PendingRow[], res: SlackDmResult) {
    const ids = rows.map((r) => r.id);
    if (res.ok) {
      await this.admin
        .from("notification_delivery")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          slack_channel_id: res.channel,
          slack_ts: res.ts,
          last_error: null,
        })
        .in("id", ids);
      this.counts.sent += ids.length;
      return;
    }
    const attemptsSoFar = Math.max(...rows.map((r) => r.attempts + 1));
    const decision = retryDecision(res.code, attemptsSoFar, res.retryAfterSec);
    await this.admin
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
      .in("id", ids);
    if (decision.status === "pending") this.counts.retrying += ids.length;
    else this.counts.failed += ids.length;
  }

  async sendOne(pending: PendingRow) {
    const [row] = await this.claim([pending]);
    if (!row) return;
    let target: string;

    if (row.channel === "slack_channel") {
      if (!row.slack_channel_id) return this.skip([row.id], "No Slack channel.");
      if (Date.now() - new Date(row.created_at).getTime() > DM_STALE_AFTER_MS) {
        return this.skip([row.id], "Older than 24 hours — not sent late.");
      }
      target = row.slack_channel_id;
    } else {
      const check = await this.dmCheck(row);
      if ("reason" in check) return this.skip([row.id], check.reason);
      target = check.slackUserId;
    }

    const card = parseStoredCard(row.blocks);
    let text: string;
    let blocks: Record<string, unknown>[] | undefined;
    if (card) {
      text = fallbackText(card.msg);
      blocks = buildCardBlocks(card, {
        baseUrl: this.baseUrl,
        deliveryId: row.id,
        showActions: !row.resolved_note,
        resolvedNote: row.resolved_note,
      });
    } else {
      const n = one(row.notification);
      text = buildDmText(
        {
          title: row.title ?? n?.title ?? "Green Dog Ops",
          body: row.body ?? n?.body ?? null,
          href: row.href ?? n?.href ?? null,
        },
        this.baseUrl,
      );
    }
    const res =
      row.channel === "slack_channel"
        ? await postSlackChannelMessage(target, text, blocks)
        : await sendSlackDirectMessage(target, text, blocks);
    await this.record([row], res);
  }

  async sendDigest(group: PendingRow[]) {
    const claimed = await this.claim(group);
    const ok: PendingRow[] = [];
    let slackUserId: string | null = null;
    for (const row of claimed) {
      const check = await this.dmCheck(row);
      if ("reason" in check) await this.skip([row.id], check.reason);
      else {
        ok.push(row);
        slackUserId = check.slackUserId;
      }
    }
    if (!ok.length || !slackUserId) return;
    const cards = ok.map((r) => parseStoredCard(r.blocks)).filter((c): c is StoredCard => !!c);
    const res =
      cards.length === 1
        ? await sendSlackDirectMessage(
            slackUserId,
            fallbackText(cards[0].msg),
            buildCardBlocks(cards[0], { baseUrl: this.baseUrl, deliveryId: ok[0].id, showActions: true }),
          )
        : await sendSlackDirectMessage(
            slackUserId,
            `${cards.length} updates from Green Dog Ops`,
            buildDigestBlocks(cards, this.baseUrl),
          );
    await this.record(ok, res);
  }
}

async function recordRun(
  options: DispatchOptions,
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
      trigger: options.trigger === "manual" ? "manual" : "scheduled",
      status,
      target_date: todayInWorkTz(),
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      records_processed: processed,
      records_new: counts.sent,
      triggered_by: options.triggeredBy ?? null,
      triggered_by_email: options.trigger === "manual" ? null : "system:cron",
      error:
        error ??
        (counts.failed > 0
          ? `${counts.failed} Slack message(s) failed — see Admin ▸ Notifications ▸ Delivery log.`
          : null),
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
