import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Insert Dept/Shift Template rows. */
export async function insertShiftTemplates(
  supabase: DbClient,
  rows: Record<string, unknown>[],
) {
  const { error } = await supabase.from("sched_shift_template").insert(rows);
  return { error };
}
