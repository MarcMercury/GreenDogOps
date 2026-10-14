import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SchedWeek } from "@/lib/schedule/types";

/** Saved week templates, newest first by name. */
export async function getTemplates(): Promise<SchedWeek[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sched_week")
    .select("*")
    .eq("is_template", true)
    .order("title");
  return (data ?? []) as SchedWeek[];
}
