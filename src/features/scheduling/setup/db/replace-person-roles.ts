import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Replace the full set of roles a single person is eligible for. */
export async function replacePersonRoles(
  personId: string,
  roleIds: string[],
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error: delErr } = await supabase
    .from("sched_role_member")
    .delete()
    .eq("person_id", personId);
  if (delErr) return { error: delErr.message };

  if (roleIds.length > 0) {
    const rows = roleIds.map((rid) => ({ role_id: rid, person_id: personId }));
    const { error } = await supabase.from("sched_role_member").insert(rows);
    if (error) return { error: error.message };
  }
  return { error: null };
}
