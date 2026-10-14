import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/**
 * Wipe a week's assignments, closures, locations and lines (children first) so
 * a copy of another week or a template lands cleanly.
 */
export async function clearWeekContents(
  supabase: DbClient,
  weekId: string,
): Promise<void> {
  await supabase.from("sched_assignment").delete().eq("week_id", weekId);
  await supabase.from("sched_closure").delete().eq("week_id", weekId);
  await supabase.from("sched_week_location").delete().eq("week_id", weekId);
  await supabase.from("sched_week_line").delete().eq("week_id", weekId);
}
