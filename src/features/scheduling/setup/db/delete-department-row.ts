import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Delete a department; its roles and shift lines go with it (cascade). */
export async function deleteDepartmentRow(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("sched_department").delete().eq("id", id);
  return { error: error?.message ?? null };
}
