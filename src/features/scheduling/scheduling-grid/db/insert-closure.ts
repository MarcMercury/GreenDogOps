import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Close a location on one day of a week. */
export async function insertClosure(
  supabase: DbClient,
  row: { week_id: string; location_id: string; day_of_week: number },
) {
  const { error } = await supabase.from("sched_closure").insert(row);
  return { error };
}
