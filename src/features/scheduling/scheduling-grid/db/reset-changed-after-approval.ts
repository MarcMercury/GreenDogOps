import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/**
 * Clear the "changed since submitted" cue on every assignment of a week. Each
 * workflow transition starts a clean baseline: only edits made while the week
 * sits in "Pending Approval" get the light-blue "changed" cue.
 */
export async function resetChangedAfterApproval(
  supabase: DbClient,
  weekId: string,
): Promise<void> {
  await supabase
    .from("sched_assignment")
    .update({ changed_after_approval: false })
    .eq("week_id", weekId)
    .eq("changed_after_approval", true);
}
