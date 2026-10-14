import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Drop shift lines from a template week; assignments on them go with them. */
export async function deleteTemplateWeekLines(ids: string[]): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sched_week_line")
    .delete()
    .in("id", ids);
  return { error: error?.message ?? null };
}
