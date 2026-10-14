/** `sched_week` id → week_start / status, as read by the request-cached lookup. */
export interface WeekLookupRow {
  id: string;
  week_start: string;
  status: string;
}

/** The `location` columns needed to label a shift's clinic (display name first). */
export interface LocationLookupRow {
  id: string;
  name: string | null;
  display_name: string | null;
  short_code: string | null;
}
