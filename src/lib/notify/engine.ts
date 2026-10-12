import "server-only";

// ---------------------------------------------------------------------------
// Notification engine: event → rule → recipients → inbox + Slack deliveries.
//
//   createEvent()          record an operational event (idempotent on dedupeKey)
//   processEvent()         claim it, resolve the audience, write the fan-out
//   processPendingEvents() cron safety net for events not processed inline
//   resolveCards()         a record was handled (PTO approved, task done):
//                          update every sent Slack card about it, drop pending
//
// emit.ts wraps these for module code. Deliveries are sent by dispatch.ts.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { updateSlackMessage } from "@/lib/slack/client";
import { appBaseUrl } from "@/lib/shared/app-url";
import { resolveAudience } from "./audience";
import { loadDirectory } from "./directory";
import { planFanout, type FanoutPlan, type PlannedDelivery } from "./plan";
import { getEventDefinition, type EventDefinition } from "./registry";
import { effectiveRule, type NotificationRuleRow } from "./rule-config";
import { buildCardBlocks, fallbackText, parseStoredCard } from "./slack-blocks";
import { EMPTY_AUDIENCE, type RuleConfig } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export interface NotificationEventRow {
  id: string;
  event_type: string;
  module: string | null;
  subject_type: string | null;
  subject_id: string | null;
  subject_person_ids: string[];
  location_id: string | null;
  actor_user_id: string | null;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  status: string;
  attempts: number;
  created_at: string;
  escalated_at: string | null;
}

const MAX_EVENT_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export async function loadRuleRow(type: string): Promise<NotificationRuleRow | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("notification_rule").select("*").eq("event_type", type).maybeSingle();
  return (data as NotificationRuleRow | null) ?? null;
}

export async function loadRule(def: EventDefinition): Promise<{ rule: RuleConfig; overridden: boolean }> {
  const row = await loadRuleRow(def.type);
  return { rule: effectiveRule(def, row), overridden: !!row };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface CreateEventInput {
  type: string;
  subjectType?: string | null;
  subjectId?: string | null;
  subjectPersonIds?: string[];
  /** People offered the event as candidates (audience option "Eligible staff"). */
  candidatePersonIds?: string[];
  locationId?: string | null;
  actorUserId?: string | null;
  payload: Record<string, unknown>;
  dedupeKey?: string | null;
}

export type CreateEventResult =
  | { ok: true; id: string; duplicate: boolean }
  | { ok: false; error: string };

export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  const def = getEventDefinition(input.type);
  if (!def) return { ok: false, error: `Unknown notification event "${input.type}".` };
  if (def.direct) return { ok: false, error: `"${input.type}" is sent with publishNotification().` };
  const admin = createAdminClient();
  const payload: Record<string, unknown> = { ...input.payload };
  if (input.candidatePersonIds?.length) payload._candidates = [...new Set(input.candidatePersonIds)];
  const { data, error } = await admin
    .from("notification_event")
    .insert({
      event_type: def.type,
      module: def.module,
      subject_type: input.subjectType ?? null,
      subject_id: input.subjectId ?? null,
      subject_person_ids: [...new Set(input.subjectPersonIds ?? [])],
      location_id: input.locationId ?? null,
      actor_user_id: input.actorUserId ?? null,
      payload,
      dedupe_key: input.dedupeKey ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505" && input.dedupeKey) {
      const { data: existing } = await admin
        .from("notification_event")
        .select("id")
        .eq("dedupe_key", input.dedupeKey)
        .maybeSingle();
      return { ok: true, id: (existing as { id: string } | null)?.id ?? "", duplicate: true };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, id: (data as { id: string }).id, duplicate: false };
}

/** Claim and fan out one pending event. Safe to call twice; only one run claims it. */
export async function processEvent(eventId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: claimedRows } = await admin
    .from("notification_event")
    .update({ status: "processing" })
    .eq("id", eventId)
    .eq("status", "pending")
    .select("*");
  const event = (claimedRows as NotificationEventRow[] | null)?.[0];
  if (!event) return;
  const attempts = event.attempts + 1;
  await admin.from("notification_event").update({ attempts }).eq("id", event.id);

  try {
    const def = getEventDefinition(event.event_type);
    if (!def || !def.render) {
      await finish(admin, event.id, "failed", 0, `Unknown event type ${event.event_type}.`);
      return;
    }
    const { rule } = await loadRule(def);
    if (!rule.enabled) {
      await finish(admin, event.id, "skipped", 0, "Turned off in Admin ▸ Notifications.");
      return;
    }
    const escalation = event.payload?._escalation === true;
    const effective: RuleConfig = escalation
      ? {
          ...rule,
          audience: { ...EMPTY_AUDIENCE, roles: rule.escalateRoles, excludeActor: false },
          channelId: null,
          batchMinutes: 0,
        }
      : rule;

    const directory = await loadDirectory();
    const candidates = Array.isArray(event.payload?._candidates)
      ? (event.payload._candidates as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const { recipients } = resolveAudience({
      audience: effective.audience,
      sensitivity: def.sensitivity,
      module: def.module,
      actionModule: def.actionModule ?? null,
      event: {
        subjectPersonIds: event.subject_person_ids ?? [],
        candidatePersonIds: candidates,
        locationId: event.location_id,
        actorUserId: event.actor_user_id,
      },
      directory,
    });
    const plan = planFanout({
      def,
      rule: effective,
      event: { id: event.id, type: event.event_type, subjectId: event.subject_id, payload: event.payload ?? {} },
      recipients,
      now: new Date(),
      escalation,
    });
    await writePlan(admin, event, def, plan);
    await finish(admin, event.id, "done", recipients.length + (plan.channel ? 1 : 0), null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish(admin, event.id, attempts >= MAX_EVENT_ATTEMPTS ? "failed" : "pending", 0, message);
  }
}

async function finish(
  admin: Admin,
  id: string,
  status: "done" | "skipped" | "failed" | "pending",
  recipientCount: number,
  error: string | null,
) {
  await admin
    .from("notification_event")
    .update({
      status,
      recipient_count: recipientCount,
      error,
      processed_at: status === "pending" ? null : new Date().toISOString(),
    })
    .eq("id", id);
}

/**
 * Cron safety net: process events the request that created them didn't
 * finish (pending for over a minute), and release ones stuck in processing.
 */
export async function processPendingEvents(limit = 25): Promise<number> {
  const admin = createAdminClient();
  const stuckBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  await admin
    .from("notification_event")
    .update({ status: "pending" })
    .eq("status", "processing")
    .lt("updated_at", stuckBefore)
    .lt("attempts", MAX_EVENT_ATTEMPTS);
  await admin
    .from("notification_event")
    .update({ status: "failed", error: "Gave up after repeated processing failures." })
    .eq("status", "processing")
    .lt("updated_at", stuckBefore)
    .gte("attempts", MAX_EVENT_ATTEMPTS);

  const olderThan = new Date(Date.now() - 60_000).toISOString();
  const { data } = await admin
    .from("notification_event")
    .select("id")
    .eq("status", "pending")
    .lt("created_at", olderThan)
    .order("created_at", { ascending: true })
    .limit(limit);
  const ids = ((data as { id: string }[] | null) ?? []).map((r) => r.id);
  for (const id of ids) await processEvent(id);
  return ids.length;
}

// ---------------------------------------------------------------------------
// Writing the fan-out
// ---------------------------------------------------------------------------

async function writePlan(admin: Admin, event: NotificationEventRow, def: EventDefinition, plan: FanoutPlan) {
  for (const pr of plan.recipients) {
    let notificationId: string | null = null;
    if (pr.inbox) {
      const { data, error } = await admin
        .from("user_notification")
        .insert({
          recipient_user_id: pr.inbox.userId,
          kind: event.event_type,
          title: pr.inbox.title,
          body: pr.inbox.body,
          href: pr.inbox.href,
          module: def.module,
          severity: pr.inbox.severity,
          actor_user_id: event.actor_user_id,
          dedupe_key: pr.inbox.dedupeKey,
          event_id: event.id,
        })
        .select("id")
        .single();
      if (!error) notificationId = (data as { id: string }).id;
      else if (error.code !== "23505") throw new Error(`Inbox write failed: ${error.message}`);
    }
    if (pr.dm) await writeDelivery(admin, event, pr.dm, notificationId);
  }
  if (plan.channel) await writeDelivery(admin, event, plan.channel, null);
}

async function writeDelivery(
  admin: Admin,
  event: Pick<NotificationEventRow, "id" | "event_type">,
  d: PlannedDelivery,
  notificationId: string | null,
) {
  const content = {
    event_id: event.id,
    notification_id: notificationId,
    event_type: event.event_type,
    title: d.title,
    body: d.body,
    href: d.href,
    blocks: d.card,
    audience_reason: d.audienceReason,
    priority: d.priority,
    message_key: d.messageKey,
    required_module: d.requiredModule,
  };

  // A pending DM for the same person + coalesce key absorbs this one.
  const coalesce = async () => {
    if (!d.coalesceKey || !d.personId || d.status !== "pending") return false;
    const { data } = await admin
      .from("notification_delivery")
      .update(content)
      .eq("recipient_person_id", d.personId)
      .eq("coalesce_key", d.coalesceKey)
      .eq("status", "pending")
      .select("id");
    return (data?.length ?? 0) > 0;
  };
  if (await coalesce()) return;

  const { error } = await admin.from("notification_delivery").insert({
    ...content,
    channel: d.channel,
    recipient_person_id: d.personId,
    recipient_user_id: d.userId,
    slack_user_id: d.slackUserId,
    slack_channel_id: d.slackChannelId,
    status: d.status,
    last_error: d.lastError,
    next_attempt_at: d.sendAt.toISOString(),
    batched: d.batched,
    coalesce_key: d.coalesceKey,
  });
  if (!error) return;
  if (error.code === "23505") {
    // Raced another writer: either the same event was already written (fine)
    // or a pending coalesce row appeared — merge into it.
    await coalesce();
    return;
  }
  throw new Error(`Delivery write failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Resolving cards (update in place)
// ---------------------------------------------------------------------------

/**
 * The record behind `messageKey` was handled. Sent cards are re-rendered
 * without buttons and with `note`; anything not yet sent is skipped.
 */
export async function resolveCards(messageKey: string, note: string): Promise<{ updated: number; failed: number }> {
  const admin = createAdminClient();
  const cleanNote = note.trim().slice(0, 300);
  await admin
    .from("notification_delivery")
    .update({ status: "skipped", last_error: `Already handled before it was sent: ${cleanNote}`, resolved_note: cleanNote })
    .eq("message_key", messageKey)
    .eq("status", "pending");

  const { data } = await admin
    .from("notification_delivery")
    .select("id, slack_channel_id, slack_ts, blocks")
    .eq("message_key", messageKey)
    .eq("status", "sent")
    .is("resolved_note", null)
    .limit(100);
  const rows = (data as { id: string; slack_channel_id: string | null; slack_ts: string | null; blocks: unknown }[] | null) ?? [];
  let updated = 0;
  let failed = 0;
  const baseUrl = appBaseUrl();
  for (const row of rows) {
    await admin.from("notification_delivery").update({ resolved_note: cleanNote }).eq("id", row.id);
    const card = parseStoredCard(row.blocks);
    if (!card || !row.slack_channel_id || !row.slack_ts) continue;
    const res = await updateSlackMessage(
      row.slack_channel_id,
      row.slack_ts,
      fallbackText(card.msg),
      buildCardBlocks(card, { baseUrl, deliveryId: row.id, showActions: false, resolvedNote: cleanNote }),
    );
    if (res.ok) updated++;
    else {
      failed++;
      await admin
        .from("notification_delivery")
        .update({ last_error: `Couldn't update the Slack message: ${res.error}` })
        .eq("id", row.id);
    }
  }
  return { updated, failed };
}
