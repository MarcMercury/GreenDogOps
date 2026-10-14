import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** The roles that already exist in the given departments. */
export async function getRolesForDepartments(
  supabase: DbClient,
  departmentIds: string[],
): Promise<{ id: string; department_id: string; name: string }[]> {
  const { data } = await supabase
    .from("sched_role")
    .select("id, department_id, name")
    .in("department_id", departmentIds);
  return (data ?? []) as { id: string; department_id: string; name: string }[];
}
