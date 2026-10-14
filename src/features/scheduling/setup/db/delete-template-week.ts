import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Delete a template and everything on its grid. */
export async function deleteTemplateWeek(templateId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  // Guarded on is_template so a mistyped id can never delete a real week.
  const { error } = await supabase
    .from("sched_week")
    .delete()
    .eq("id", templateId)
    .eq("is_template", true);
  return { error: error?.message ?? null };
}
