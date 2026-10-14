import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Set a week's title and notes (null clears). */
export async function updateWeekTitleNotes(
  supabase: DbClient,
  weekId: string,
  title: string | null,
  notes: string | null,
) {
  const { error } = await supabase
    .from("sched_week")
    .update({ title, notes })
    .eq("id", weekId);
  return { error };
}
