import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Re-point an assignment at another (line, location, day) cell in place, preserving its history. */
export async function updateAssignmentCell(
  supabase: DbClient,
  assignmentId: string,
  patch: {
    line_id: string;
    location_id: string;
    day_of_week: number;
    work_date: string;
    changed_after_approval?: boolean;
  },
) {
  const { error } = await supabase
    .from("sched_assignment")
    .update(patch)
    .eq("id", assignmentId);
  return { error };
}
