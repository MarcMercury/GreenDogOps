import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/**
 * A relocation resolves any auto-absence recorded earlier the same day: the
 * person's auto-absent rows for that date go back to "scheduled".
 */
export async function clearAutoAbsences(
  supabase: DbClient,
  weekId: string,
  personId: string,
  workDate: string,
): Promise<void> {
  await supabase
    .from("sched_assignment")
    .update({
      auto_absent: false,
      attendance_status: "scheduled",
      attendance_note: "Relocated — auto-absence cleared.",
    })
    .eq("week_id", weekId)
    .eq("person_id", personId)
    .eq("work_date", workDate)
    .eq("auto_absent", true);
}
