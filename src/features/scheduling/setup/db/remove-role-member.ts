import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Remove a person's eligibility for a role. */
export async function removeRoleMember(
  roleId: string,
  personId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sched_role_member")
    .delete()
    .eq("role_id", roleId)
    .eq("person_id", personId);
  return { error: error?.message ?? null };
}
