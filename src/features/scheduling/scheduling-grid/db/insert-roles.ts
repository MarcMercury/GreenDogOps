import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Insert roles and return their new ids with department and name. */
export async function insertRoles(
  supabase: DbClient,
  rows: { department_id: string; name: string; sort_order: number }[],
) {
  const { data, error } = await supabase
    .from("sched_role")
    .insert(rows)
    .select("id, department_id, name");
  return {
    data: (data ?? []) as { id: string; department_id: string; name: string }[],
    error,
  };
}
