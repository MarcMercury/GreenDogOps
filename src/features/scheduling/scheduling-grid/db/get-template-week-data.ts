import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SchedWeek } from "@/lib/schedule/types";
import { getWeekDataFor } from "@/features/scheduling/scheduling-grid/db/get-week-data-for";
import type { WeekData } from "@/features/scheduling/scheduling-grid/types/week-data";

/** Full grid payload for one template. */
export async function getTemplateWeekData(
  templateId: string,
): Promise<WeekData | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sched_week")
    .select("*")
    .eq("id", templateId)
    .eq("is_template", true)
    .maybeSingle();
  const week = data as SchedWeek | null;
  if (!week) return null;
  return getWeekDataFor(week);
}
