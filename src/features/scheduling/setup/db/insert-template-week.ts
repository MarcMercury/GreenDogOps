import "server-only";
import { createClient } from "@/lib/supabase/server";
import { TEMPLATE_WEEK_START } from "@/features/scheduling/setup/lib/template-week-start";

/**
 * Create a named week template: a normal `sched_week` flagged `is_template` on
 * the sentinel week_start. Returns the raw database error (the action maps a
 * duplicate name to a friendly message).
 */
export async function insertTemplateWeek(
  title: string,
  createdBy: string | null,
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sched_week")
    .insert({
      week_start: TEMPLATE_WEEK_START,
      title,
      status: "draft",
      is_template: true,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: (data as { id: string }).id };
}
