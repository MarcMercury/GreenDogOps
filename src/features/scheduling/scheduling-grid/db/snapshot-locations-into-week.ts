import "server-only";
import type { ActiveLocationRow } from "@/features/scheduling/scheduling-grid/types/active-location-row";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/**
 * Snapshot the active locations into a new week's `sched_week_location` rows.
 * Returns the location rows so the caller can derive the default closures from
 * the same read.
 */
export async function snapshotLocationsIntoWeek(
  supabase: DbClient,
  weekId: string,
): Promise<ActiveLocationRow[]> {
  const { data: locs } = await supabase
    .from("location")
    .select("id, short_code, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  const rows = (locs ?? []) as ActiveLocationRow[];
  const weekLocs = rows.map((l) => ({
    week_id: weekId,
    location_id: l.id,
    sort_order: l.sort_order ?? 0,
  }));
  if (weekLocs.length > 0)
    await supabase.from("sched_week_location").insert(weekLocs);
  return rows;
}
