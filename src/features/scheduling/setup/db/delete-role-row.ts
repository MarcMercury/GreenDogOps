import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Delete a role; this clears every employee's eligibility for it. */
export async function deleteRoleRow(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("sched_role").delete().eq("id", id);
  return { error: error?.message ?? null };
}
