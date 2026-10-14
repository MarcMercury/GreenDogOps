import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Delete an assignment row outright (draft weeks, post-publish adds, relocations). */
export async function deleteAssignment(
  supabase: DbClient,
  assignmentId: string,
) {
  const { error } = await supabase
    .from("sched_assignment")
    .delete()
    .eq("id", assignmentId);
  return { error };
}
