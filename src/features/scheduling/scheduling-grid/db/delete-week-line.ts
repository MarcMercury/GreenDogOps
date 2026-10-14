import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Delete a shift line (its assignments go with it). */
export async function deleteWeekLine(supabase: DbClient, lineId: string) {
  const { error } = await supabase
    .from("sched_week_line")
    .delete()
    .eq("id", lineId);
  return { error };
}
