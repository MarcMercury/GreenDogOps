import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";
import type { DayStaffingRole } from "@/features/scheduling/scheduling-grid/lib/day-staffing";

/** Every role's id and name, for bucketing shifts into staffing categories. */
export async function getRoleNames(supabase: DbClient): Promise<DayStaffingRole[]> {
  const { data } = await supabase.from("sched_role").select("id, name");
  return (data ?? []) as DayStaffingRole[];
}
