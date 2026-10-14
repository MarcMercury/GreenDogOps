import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Replace the full member list of a role with the given person ids. */
export async function replaceRoleMembers(
  roleId: string,
  personIds: string[],
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error: delErr } = await supabase
    .from("sched_role_member")
    .delete()
    .eq("role_id", roleId);
  if (delErr) return { error: delErr.message };

  if (personIds.length > 0) {
    const rows = personIds.map((pid) => ({ role_id: roleId, person_id: pid }));
    const { error } = await supabase.from("sched_role_member").insert(rows);
    if (error) return { error: error.message };
  }
  return { error: null };
}
