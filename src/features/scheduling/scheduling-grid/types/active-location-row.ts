/** The location columns a new week snapshots (`location` → `sched_week_location` + default closures). */
export interface ActiveLocationRow {
  id: string;
  short_code: string | null;
  sort_order: number | null;
}
