import "server-only";

// Marketing-event notifications: created, updated, staff assigned, canceled.
// Called from the Marketing Server Actions after the save succeeded.

import { createAdminClient } from "@/lib/supabase/admin";
import { todayInWorkTz } from "@/lib/worklist/dates";
import { emitEvent } from "../emit";
import { personDisplayName } from "../directory";
import {
  isCanceled,
  isInactiveEvent,
  MARKETING_EVENT_COLUMNS,
  marketingChanges,
  marketingPayload,
  newlyAssigned,
  staffIds,
  type MarketingEventRow,
} from "./marketing-rules";

type Admin = ReturnType<typeof createAdminClient>;

export async function loadMarketingEvent(id: string): Promise<MarketingEventRow | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("marketing_event").select(MARKETING_EVENT_COLUMNS).eq("id", id).maybeSingle();
  return (data as MarketingEventRow | null) ?? null;
}

async function staffNames(admin: Admin, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data } = await admin
    .from("person")
    .select("id, full_name, first_name, last_name, preferred_name")
    .in("id", ids);
  const byId = new Map(
    ((data ?? []) as (Parameters<typeof personDisplayName>[0] & { id: string })[]).map((p) => [p.id, personDisplayName(p)]),
  );
  return ids.map((id) => byId.get(id)).filter((n): n is string => !!n);
}

/**
 * Compare the event before and after a save and emit what changed.
 * `before` is null for a new event; `after` null when it was deleted.
 */
export async function notifyMarketingEventSaved(input: {
  before: MarketingEventRow | null;
  after: MarketingEventRow | null;
  actorUserId: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const today = todayInWorkTz();
  const { before, after } = input;

  // Deleted: treat as canceled for anyone still staffed on an upcoming event.
  if (!after) {
    if (!before || isCanceled(before.status) || isInactiveEvent(before, today)) return;
    const ids = staffIds(before);
    await emitEvent({
      type: "marketing.event_canceled",
      subjectType: "marketing_event",
      subjectId: before.id,
      subjectPersonIds: ids,
      actorUserId: input.actorUserId,
      payload: { ...marketingPayload(before, await staffNames(admin, ids)), deleted: true },
      dedupeKey: `marketing.event_canceled:${before.id}`,
    });
    return;
  }

  if (isInactiveEvent(after, today)) return;
  const ids = staffIds(after);
  const payload = marketingPayload(after, await staffNames(admin, ids));

  if (!before) {
    await emitEvent({
      type: "marketing.event_created",
      subjectType: "marketing_event",
      subjectId: after.id,
      subjectPersonIds: [],
      actorUserId: input.actorUserId,
      payload,
      dedupeKey: `marketing.event_created:${after.id}`,
    });
  } else if (isCanceled(after.status) && !isCanceled(before.status)) {
    await emitEvent({
      type: "marketing.event_canceled",
      subjectType: "marketing_event",
      subjectId: after.id,
      subjectPersonIds: [...new Set([...ids, ...staffIds(before)])],
      actorUserId: input.actorUserId,
      payload,
      dedupeKey: `marketing.event_canceled:${after.id}:${Date.now()}`,
    });
    return;
  } else {
    const changes = marketingChanges(before, after);
    if (changes.length && !isCanceled(after.status)) {
      // People newly added get their own "you're staffing" message instead.
      const added = new Set(newlyAssigned(before, after));
      await emitEvent({
        type: "marketing.event_updated",
        subjectType: "marketing_event",
        subjectId: after.id,
        subjectPersonIds: ids.filter((id) => !added.has(id)),
        actorUserId: input.actorUserId,
        payload: { ...payload, changes },
        dedupeKey: `marketing.event_updated:${after.id}:${Date.now()}`,
      });
    }
  }

  if (isCanceled(after.status)) return;
  const added = newlyAssigned(before, after);
  if (added.length) {
    await emitEvent({
      type: "marketing.staff_assigned",
      subjectType: "marketing_event",
      subjectId: after.id,
      subjectPersonIds: added,
      actorUserId: input.actorUserId,
      payload,
      dedupeKey: `marketing.staff_assigned:${after.id}:${Date.now()}`,
    });
  }
}
