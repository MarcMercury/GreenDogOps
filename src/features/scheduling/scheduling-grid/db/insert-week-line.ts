import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Add one ad-hoc shift line to a week (not derived from a template). */
export async function insertWeekLine(
  supabase: DbClient,
  row: {
    week_id: string;
    department_id: string;
    role_id: string | null;
    label: string | null;
    start_time: string | null;
    end_time: string | null;
    sort_order: number;
  },
) {
  const { error } = await supabase
    .from("sched_week_line")
    .insert({ ...row, is_adhoc: true });
  return { error };
}
