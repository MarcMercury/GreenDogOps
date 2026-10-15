/**
 * Google gives an invitation the same event id on every attendee's calendar,
 * and calendar_event.google_event_id is unique across calendars. So an event
 * already mirrored from another calendar is skipped here and shown once, under
 * the calendar that stored it first. A repeated id within one batch is kept
 * once too — which copy doesn't matter, overlapping calendars hold the same event.
 */
export function partitionNewEvents<T extends { google_event_id: string }>(
  rows: T[],
  ownedByOtherCalendars: ReadonlySet<string>,
): { insert: T[]; shared: number } {
  const seen = new Set<string>();
  const insert = rows.filter((r) => {
    if (ownedByOtherCalendars.has(r.google_event_id) || seen.has(r.google_event_id)) return false;
    seen.add(r.google_event_id);
    return true;
  });
  return { insert, shared: rows.length - insert.length };
}

/** Postgres unique_violation — another calendar stored the same event id first. */
export const UNIQUE_VIOLATION = "23505";
