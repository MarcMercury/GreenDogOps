import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Every department's id and name (active or not), for name-based matching. */
export async function getDepartmentNames(
  supabase: DbClient,
): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("sched_department").select("id, name");
  return (data ?? []) as { id: string; name: string }[];
}
