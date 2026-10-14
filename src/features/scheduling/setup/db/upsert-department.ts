import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DepartmentInput } from "@/features/scheduling/setup/schema/department.schema";

/** Update the department when an id is given, otherwise insert a new one. */
export async function upsertDepartment(
  id: string | null,
  patch: Omit<DepartmentInput, "id">,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("sched_department").update(patch).eq("id", id)
    : await supabase.from("sched_department").insert(patch);
  return { error: error?.message ?? null };
}
