import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SchedWeekLine } from "@/lib/schedule/types";

/** Every shift line on a template week. */
export async function getTemplateWeekLines(
  weekId: string,
): Promise<{ lines: SchedWeekLine[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sched_week_line")
    .select("*")
    .eq("week_id", weekId);
  return { lines: (data ?? []) as SchedWeekLine[], error: error?.message ?? null };
}
