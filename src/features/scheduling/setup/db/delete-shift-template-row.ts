import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Delete a Dept/Shift Template line. */
export async function deleteShiftTemplateRow(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sched_shift_template")
    .delete()
    .eq("id", id);
  return { error: error?.message ?? null };
}
