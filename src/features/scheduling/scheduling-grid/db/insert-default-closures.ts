import "server-only";
import type { ActiveLocationRow } from "@/features/scheduling/scheduling-grid/types/active-location-row";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/**
 * Default closures for a new week:
 *  - every location closed on Sundays (day_of_week 0)
 *  - Sherman Oaks (SO) also closed on Tuesdays (2) and Wednesdays (3)
 */
export async function insertDefaultClosures(
  supabase: DbClient,
  weekId: string,
  locs: ActiveLocationRow[],
): Promise<void> {
  const defaultClosures = locs.flatMap((l) => {
    const days = [0];
    if (l.short_code === "SO") days.push(2, 3);
    return days.map((day_of_week) => ({
      week_id: weekId,
      location_id: l.id,
      day_of_week,
      reason: null,
    }));
  });
  if (defaultClosures.length > 0)
    await supabase.from("sched_closure").insert(defaultClosures);
}
