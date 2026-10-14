import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TemplateWeekLinePatch } from "@/features/scheduling/setup/lib/template-sync-plan";

/** Re-sync one drifted template-week line to its shift template's fields. */
export async function updateTemplateWeekLine(
  id: string,
  patch: TemplateWeekLinePatch,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sched_week_line")
    .update(patch)
    .eq("id", id);
  return { error: error?.message ?? null };
}
