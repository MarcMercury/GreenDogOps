import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** A week's identity (start date and whether it is a template), or null. */
export async function findWeekById(
  supabase: DbClient,
  weekId: string,
): Promise<{ id: string; week_start: string; is_template: boolean } | null> {
  const { data } = await supabase
    .from("sched_week")
    .select("id, week_start, is_template")
    .eq("id", weekId)
    .maybeSingle();
  return (
    (data as { id: string; week_start: string; is_template: boolean } | null) ??
    null
  );
}
