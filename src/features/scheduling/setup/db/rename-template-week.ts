import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Rename a template. Returns the raw database error (a duplicate name included). */
export async function renameTemplateWeek(
  templateId: string,
  title: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sched_week")
    .update({ title })
    .eq("id", templateId)
    .eq("is_template", true);
  return { error: error?.message ?? null };
}
