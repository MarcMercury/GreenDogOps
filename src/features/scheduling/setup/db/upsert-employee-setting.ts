import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Fields of the one `sched_employee_setting` row per person that Set Up and the
 * HR profile write. Only the keys present are changed on an existing row.
 */
export interface EmployeeSettingPatch {
  person_id: string;
  weekly_shift_target?: number;
  is_schedulable?: boolean;
  default_location_id?: string | null;
  eligible_location_ids?: string[];
  available_days?: number[];
}

/** Insert or update a person's scheduling settings row. */
export async function upsertEmployeeSetting(
  patch: EmployeeSettingPatch,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sched_employee_setting")
    .upsert(patch, { onConflict: "person_id" });
  return { error: error?.message ?? null };
}
