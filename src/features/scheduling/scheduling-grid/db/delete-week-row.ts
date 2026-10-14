import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Delete a week and (by cascade) everything on its grid. */
export async function deleteWeekRow(supabase: DbClient, weekId: string) {
  const { error } = await supabase.from("sched_week").delete().eq("id", weekId);
  return { error };
}
