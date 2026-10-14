import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SchedShiftTemplate } from "@/lib/schedule/types";

/** Active Dept/Shift Template lines in display order. */
export async function getActiveShiftTemplates(): Promise<{
  templates: SchedShiftTemplate[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sched_shift_template")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  return {
    templates: (data ?? []) as SchedShiftTemplate[],
    error: error?.message ?? null,
  };
}
