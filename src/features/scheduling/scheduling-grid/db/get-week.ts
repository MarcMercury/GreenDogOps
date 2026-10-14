import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SchedWeek } from "@/lib/schedule/types";

/** One week (or template) row by id. */
export async function getWeek(weekId: string): Promise<SchedWeek | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sched_week")
    .select("*")
    .eq("id", weekId)
    .maybeSingle();
  return (data as SchedWeek | null) ?? null;
}
