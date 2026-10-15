/**
 * Google gives an invitation the same event id on every attendee's calendar,
 * and calendar_event.google_event_id is unique across calendars. So an event
 * already mirrored from another calendar is skipped here and shown once, under
 * the calendar that stored it first.
 */
export function partitionNewEvents<T extends { google_event_id: string }>(
  rows: T[],
  ownedByOtherCalendars: ReadonlySet<string>,
): { insert: T[]; shared: number } {
  const insert = rows.filter((r) => !ownedByOtherCalendars.has(r.google_event_id));
  return { insert, shared: rows.length - insert.length };
}
