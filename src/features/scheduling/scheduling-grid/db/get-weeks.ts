import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SchedWeek } from "@/lib/schedule/types";

/** Weeks list (most recent first). Excludes the reusable Week Template. */
export async function getWeeks(): Promise<SchedWeek[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sched_week")
    .select("*")
    .eq("is_template", false)
    .order("week_start", { ascending: false });
  return (data ?? []) as SchedWeek[];
}
