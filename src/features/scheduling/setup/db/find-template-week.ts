import "server-only";
import { createClient } from "@/lib/supabase/server";

/** The template week with this id, or null when it is missing or a real week. */
export async function findTemplateWeek(templateId: string): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sched_week")
    .select("id")
    .eq("id", templateId)
    .eq("is_template", true)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}
