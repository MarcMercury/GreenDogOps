import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface ShiftTemplatePatch {
  department_id: string;
  role_id: string | null;
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  sort_order: number;
  is_active: boolean;
}

/** Update the shift template when an id is given, otherwise insert a new one. */
export async function upsertShiftTemplate(
  id: string | null,
  patch: ShiftTemplatePatch,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("sched_shift_template").update(patch).eq("id", id)
    : await supabase.from("sched_shift_template").insert(patch);
  return { error: error?.message ?? null };
}
