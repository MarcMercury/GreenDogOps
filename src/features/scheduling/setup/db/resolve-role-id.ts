import "server-only";
import type { createClient } from "@/lib/supabase/server";

/**
 * Resolve the role id for a shift line: use an existing role id when provided,
 * otherwise find-or-create a role in the department from a typed name. Matching
 * is by case-insensitive name within the department so the same shift/role name
 * (e.g. "Clinic Tech" used at 8a, 9a and 10a) always maps to a single role — and
 * therefore a single eligibility checkbox — instead of spawning duplicates.
 */
export async function resolveRoleId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  departmentId: string,
  roleId: string | null,
  newRoleName: string | null,
): Promise<{ id: string | null } | { error: string }> {
  if (roleId) return { id: roleId };
  const name = newRoleName?.trim();
  if (!name) return { id: null };

  const { data: existing, error: findErr } = await supabase
    .from("sched_role")
    .select("id")
    .eq("department_id", departmentId)
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (findErr) return { error: findErr.message };
  if (existing) return { id: (existing as { id: string }).id };

  const { data, error } = await supabase
    .from("sched_role")
    .insert({ department_id: departmentId, name, sort_order: 9999 })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: (data as { id: string }).id };
}
