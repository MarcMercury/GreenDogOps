import "server-only";

// ---------------------------------------------------------------------------
// Time-based notification producers, run by the 5-minute dispatcher.
//
//   escalations       an action-required event (e.g. a PTO request) still
//                     open after the rule's escalate_after_hours → re-notify
//                     the rule's escalation roles once.
//   event reminders   marketing events starting tomorrow → their staff, once,
//                     from 10am Pacific.
//
// Both are idempotent (escalated_at / dedupe keys), so overlapping runs are safe.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, todayInWorkTz, WORK_TZ } from "@/lib/worklist/dates";
import { createEvent, loadRule, processEvent, type NotificationEventRow } from "./engine";
import { EVENT_REGISTRY } from "./registry";
import { MARKETING_EVENT_COLUMNS, isCanceled, marketingPayload, staffIds, type MarketingEventRow } from "./events/marketing-rules";
import { personDisplayName } from "./directory";

type Admin = ReturnType<typeof createAdminClient>;

/** Ids of subjects whose action is still outstanding, per event type. */
const STILL_OPEN: Record<string, (admin: Admin, subjectIds: string[]) => Promise<Set<string>>> = {
  "pto.requested": async (admin, ids) => {
    const { data } = await admin.from("person_time_off").select("id").in("id", ids).eq("status", "requested");
    return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  },
};

export async function runProducers(now = new Date()): Promise<number> {
  let produced = 0;
  try {
    produced += await produceEscalations(now);
  } catch (err) {
    console.error("[notify] escalations:", err instanceof Error ? err.message : err);
  }
  try {
    produced += await produceEventReminders(now);
  } catch (err) {
    console.error("[notify] event reminders:", err instanceof Error ? err.message : err);
  }
  return produced;
}

async function produceEscalations(now: Date): Promise<number> {
  const admin = createAdminClient();
  let produced = 0;
  for (const def of EVENT_REGISTRY.values()) {
    if (!def.escalatable || !STILL_OPEN[def.type]) continue;
    const { rule } = await loadRule(def);
    if (!rule.enabled || !rule.escalateAfterHours || !rule.escalateRoles.length) continue;
    const cutoff = new Date(now.getTime() - rule.escalateAfterHours * 3_600_000).toISOString();
    // Never escalate something older than a week — it was handled elsewhere or abandoned.
    const floor = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const { data } = await admin
      .from("notification_event")
      .select("*")
      .eq("event_type", def.type)
      .eq("status", "done")
      .is("escalated_at", null)
      .not("dedupe_key", "like", "escalation:%")
      .lt("created_at", cutoff)
      .gt("created_at", floor)
      .limit(50);
    const events = ((data ?? []) as NotificationEventRow[]).filter((e) => e.payload?._escalation !== true);
    if (!events.length) continue;
    const open = await STILL_OPEN[def.type](admin, events.map((e) => e.subject_id).filter((x): x is string => !!x));
    for (const e of events) {
      // Claim first so two runs can't both escalate it.
      const { data: claimed } = await admin
        .from("notification_event")
        .update({ escalated_at: now.toISOString() })
        .eq("id", e.id)
        .is("escalated_at", null)
        .select("id");
      if (!claimed?.length || !e.subject_id || !open.has(e.subject_id)) continue;
      const created = await createEvent({
        type: e.event_type,
        subjectType: e.subject_type,
        subjectId: e.subject_id,
        subjectPersonIds: e.subject_person_ids,
        locationId: e.location_id,
        payload: { ...e.payload, _escalation: true },
        dedupeKey: `escalation:${e.id}`,
      });
      if (created.ok && !created.duplicate) {
        await processEvent(created.id);
        produced++;
      }
    }
  }
  return produced;
}

function hourInWorkTz(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: WORK_TZ, hour: "numeric", hourCycle: "h23" }).format(now),
  );
}

async function produceEventReminders(now: Date): Promise<number> {
  if (hourInWorkTz(now) < 10) return 0;
  const def = EVENT_REGISTRY.get("marketing.event_upcoming");
  if (!def) return 0;
  const { rule } = await loadRule(def);
  if (!rule.enabled) return 0;

  const admin = createAdminClient();
  const tomorrow = addDays(todayInWorkTz(now), 1);
  const { data } = await admin
    .from("marketing_event")
    .select(MARKETING_EVENT_COLUMNS)
    .eq("starts_on", tomorrow)
    .limit(100);
  let produced = 0;
  for (const row of (data ?? []) as MarketingEventRow[]) {
    if (isCanceled(row.status)) continue;
    const ids = staffIds(row);
    if (!ids.length) continue;
    const { data: people } = await admin
      .from("person")
      .select("id, full_name, first_name, last_name, preferred_name")
      .in("id", ids);
    const names = ((people ?? []) as (Parameters<typeof personDisplayName>[0] & { id: string })[]).map(personDisplayName);
    const created = await createEvent({
      type: "marketing.event_upcoming",
      subjectType: "marketing_event",
      subjectId: row.id,
      subjectPersonIds: ids,
      payload: marketingPayload(row, names),
      dedupeKey: `marketing.event_upcoming:${row.id}:${tomorrow}`,
    });
    if (created.ok && !created.duplicate) {
      await processEvent(created.id);
      produced++;
    }
  }
  return produced;
}
