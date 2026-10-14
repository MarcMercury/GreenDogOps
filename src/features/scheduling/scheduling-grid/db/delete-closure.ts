import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Re-open a location/day by deleting its closure row. */
export async function deleteClosure(supabase: DbClient, closureId: string) {
  const { error } = await supabase
    .from("sched_closure")
    .delete()
    .eq("id", closureId);
  return { error };
}
