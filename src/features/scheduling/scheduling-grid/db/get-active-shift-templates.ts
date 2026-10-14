import "server-only";
import type { SchedShiftTemplate } from "@/lib/schedule/types";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** The active Dept/Shift Template lines, in display order. */
export async function getActiveShiftTemplates(
  supabase: DbClient,
): Promise<SchedShiftTemplate[]> {
  const { data } = await supabase
    .from("sched_shift_template")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as SchedShiftTemplate[];
}
