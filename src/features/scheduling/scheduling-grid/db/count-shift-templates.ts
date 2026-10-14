import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** How many Dept/Shift Template rows exist (0 = the default template was never seeded). */
export async function countShiftTemplates(supabase: DbClient): Promise<number> {
  const { count } = await supabase
    .from("sched_shift_template")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}
