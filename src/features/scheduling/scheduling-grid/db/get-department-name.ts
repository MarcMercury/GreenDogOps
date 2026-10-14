import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** A department's name, for naming a generated guide. */
export async function getDepartmentName(
  supabase: DbClient,
  departmentId: string,
): Promise<{ name: string | null } | null> {
  const { data } = await supabase
    .from("sched_department")
    .select("name")
    .eq("id", departmentId)
    .maybeSingle();
  return (data as { name: string | null } | null) ?? null;
}
