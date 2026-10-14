import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Make a person eligible for a role. Already-eligible is a no-op. */
export async function addRoleMember(
  roleId: string,
  personId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sched_role_member")
    .upsert(
      { role_id: roleId, person_id: personId },
      { onConflict: "role_id,person_id", ignoreDuplicates: true },
    );
  return { error: error?.message ?? null };
}
