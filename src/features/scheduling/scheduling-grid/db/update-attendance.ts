import "server-only";
import type { AttendanceStatus } from "@/lib/schedule/types";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Store a scheduler's attendance mark on a shift (and clear any auto-absence flag). */
export async function updateAttendance(
  supabase: DbClient,
  assignmentId: string,
  mark: {
    status: AttendanceStatus;
    note: string | null;
    markedBy: string | null;
    markedAt: string;
  },
) {
  const { error } = await supabase
    .from("sched_assignment")
    .update({
      attendance_status: mark.status,
      attendance_note: mark.note,
      attendance_marked_by: mark.markedBy,
      attendance_marked_at: mark.markedAt,
      auto_absent: false,
    })
    .eq("id", assignmentId);
  return { error };
}
