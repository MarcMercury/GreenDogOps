import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";
import type { DayStaffingAssignment } from "@/features/scheduling/scheduling-grid/lib/day-staffing";

/** Who is staffed at one location on one day of a week (removed rows included, flagged). */
export async function getDayAssignments(
  supabase: DbClient,
  weekId: string,
  day: number,
  locationId: string,
): Promise<DayStaffingAssignment[]> {
  const { data } = await supabase
    .from("sched_assignment")
    .select("person_id, line_id, removed_post_publish")
    .eq("week_id", weekId)
    .eq("day_of_week", day)
    .eq("location_id", locationId);
  return (data ?? []) as DayStaffingAssignment[];
}
