import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Edit an existing shift line on a week's grid. */
export async function updateWeekLineRow(
  supabase: DbClient,
  lineId: string,
  patch: {
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
    .update(patch)
    .eq("id", lineId);
  return { error };
}
