import "server-only";
import type { ScheduleStatus } from "@/lib/schedule/types";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** A week's workflow status and start date, or null when the week no longer exists. */
export async function getWeekStatus(
  supabase: DbClient,
  weekId: string,
): Promise<{ week_start: string; status: ScheduleStatus } | null> {
  const { data } = await supabase
    .from("sched_week")
    .select("week_start, status")
    .eq("id", weekId)
    .maybeSingle();
  return (data as { week_start: string; status: ScheduleStatus } | null) ?? null;
}
