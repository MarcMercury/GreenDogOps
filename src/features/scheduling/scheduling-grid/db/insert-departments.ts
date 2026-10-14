import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Insert departments and return their new ids with names. */
export async function insertDepartments(
  supabase: DbClient,
  rows: { name: string; color: string; sort_order: number }[],
) {
  const { data, error } = await supabase
    .from("sched_department")
    .insert(rows)
    .select("id, name");
  return { data: (data ?? []) as { id: string; name: string }[], error };
}
