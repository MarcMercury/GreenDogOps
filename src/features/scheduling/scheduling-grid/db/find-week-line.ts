import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** A shift line only if it belongs to the given week (guards drag targets). */
export async function findWeekLine(
  supabase: DbClient,
  lineId: string,
  weekId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("sched_week_line")
    .select("id")
    .eq("id", lineId)
    .eq("week_id", weekId)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}
