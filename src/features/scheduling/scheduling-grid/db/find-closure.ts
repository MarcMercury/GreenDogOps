import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** The closure row for one location/day of a week, if it is closed. */
export async function findClosure(
  supabase: DbClient,
  weekId: string,
  locationId: string,
  dayOfWeek: number,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("sched_closure")
    .select("id")
    .eq("week_id", weekId)
    .eq("location_id", locationId)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}
