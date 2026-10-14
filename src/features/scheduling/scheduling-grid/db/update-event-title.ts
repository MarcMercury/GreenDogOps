import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Change the text of an existing event banner. */
export async function updateEventTitle(
  supabase: DbClient,
  eventId: string,
  title: string,
) {
  const { error } = await supabase
    .from("sched_event")
    .update({ title })
    .eq("id", eventId);
  return { error };
}
