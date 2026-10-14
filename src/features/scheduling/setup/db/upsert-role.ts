import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { RoleInput } from "@/features/scheduling/setup/schema/role.schema";

/** Update the role when an id is given, otherwise insert a new one. */
export async function upsertRole(
  id: string | null,
  patch: Omit<RoleInput, "id">,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("sched_role").update(patch).eq("id", id)
    : await supabase.from("sched_role").insert(patch);
  return { error: error?.message ?? null };
}
