import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Apply a workflow transition's column patch (status + who/when stamps) to a week. */
export async function updateWeekStatus(
  supabase: DbClient,
  weekId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("sched_week")
    .update(patch)
    .eq("id", weekId);
  return { error };
}
