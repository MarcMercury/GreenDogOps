import "server-only";
import type { AssignmentRow } from "@/features/scheduling/scheduling-grid/types/assignment-row";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/**
 * Re-load an assignment server-side before changing it — never trust
 * client-supplied context about which week, person or cell a row belongs to.
 */
export async function getAssignment(
  supabase: DbClient,
  assignmentId: string,
): Promise<AssignmentRow | null> {
  const { data } = await supabase
    .from("sched_assignment")
    .select(
      "id, week_id, line_id, location_id, day_of_week, person_id, work_date, attendance_status, removed_post_publish, added_post_publish",
    )
    .eq("id", assignmentId)
    .maybeSingle();
  return (data as AssignmentRow | null) ?? null;
}
