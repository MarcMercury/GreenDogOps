import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Add an event banner above a location/day cell. */
export async function insertEvent(
  supabase: DbClient,
  row: { week_id: string; location_id: string; day_of_week: number; title: string },
) {
  const { error } = await supabase.from("sched_event").insert(row);
  return { error };
}
