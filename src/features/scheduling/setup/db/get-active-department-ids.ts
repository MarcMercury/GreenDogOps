import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Ids of the active departments. */
export async function getActiveDepartmentIds(): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sched_department")
    .select("id")
    .eq("is_active", true);
  return new Set(((data ?? []) as { id: string }[]).map((d) => d.id));
}
