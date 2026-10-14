import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** A week's start date, or null when the week no longer exists. */
export async function getWeekStart(
  supabase: DbClient,
  weekId: string,
): Promise<{ week_start: string | null } | null> {
  const { data } = await supabase
    .from("sched_week")
    .select("week_start")
    .eq("id", weekId)
    .maybeSingle();
  return (data as { week_start: string | null } | null) ?? null;
}
