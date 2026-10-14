import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Insert shift lines onto a week's grid. */
export async function insertWeekLines(
  supabase: DbClient,
  rows: Record<string, unknown>[],
) {
  const { error } = await supabase.from("sched_week_line").insert(rows);
  return { error };
}
