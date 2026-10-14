import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Upsert by appt_type so newly-observed types create a row on first save. */
export async function upsertApptTypeDept(row: {
  appt_type: string;
  department_id: string | null;
  is_ignored: boolean;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("ezyvet_appt_type_dept_map")
    .upsert(row, { onConflict: "appt_type" });
  return { error: error?.message ?? null };
}
