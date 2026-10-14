import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TemplateWeekLineInsert } from "@/features/scheduling/setup/lib/template-sync-plan";

/** Add shift lines, copied from shift templates, to a template week. */
export async function insertTemplateWeekLines(
  rows: TemplateWeekLineInsert[],
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("sched_week_line").insert(rows);
  return { error: error?.message ?? null };
}
