import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Most recent existing week strictly before the given start date. */
export async function getPreviousWeek(
  supabase: DbClient,
  weekStart: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("sched_week")
    .select("id")
    .lt("week_start", weekStart)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}
