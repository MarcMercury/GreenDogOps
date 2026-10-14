import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/**
 * Keep a published shift as an absence record instead of deleting it: flagged
 * removed-post-publish, auto-absent, and marked absent.
 */
export async function markRemovedPostPublish(
  supabase: DbClient,
  assignmentId: string,
) {
  const { error } = await supabase
    .from("sched_assignment")
    .update({
      removed_post_publish: true,
      auto_absent: true,
      attendance_status: "absent",
      attendance_note: "Auto-absence: removed after publish, not relocated.",
    })
    .eq("id", assignmentId);
  return { error };
}
