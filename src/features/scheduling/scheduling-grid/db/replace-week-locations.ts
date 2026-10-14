import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Replace the ordered set of locations shown on a week's grid. */
export async function replaceWeekLocations(
  supabase: DbClient,
  weekId: string,
  locationIds: string[],
) {
  await supabase.from("sched_week_location").delete().eq("week_id", weekId);
  if (locationIds.length > 0) {
    const rows = locationIds.map((id, i) => ({
      week_id: weekId,
      location_id: id,
      sort_order: i * 10,
    }));
    const { error } = await supabase.from("sched_week_location").insert(rows);
    return { error };
  }
  return { error: null };
}
