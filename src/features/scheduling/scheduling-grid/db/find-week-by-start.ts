import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** The week that starts on a given Sunday, if one has been created. */
export async function findWeekByStart(
  supabase: DbClient,
  weekStart: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("sched_week")
    .select("id")
    .eq("week_start", weekStart)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}
