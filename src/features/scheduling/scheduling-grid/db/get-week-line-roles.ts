import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";
import type { DayStaffingLine } from "@/features/scheduling/scheduling-grid/lib/day-staffing";

/** A week's shift lines with just their role and department. */
export async function getWeekLineRoles(
  supabase: DbClient,
  weekId: string,
): Promise<DayStaffingLine[]> {
  const { data } = await supabase
    .from("sched_week_line")
    .select("id, role_id, department_id")
    .eq("week_id", weekId);
  return (data ?? []) as DayStaffingLine[];
}
