import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Remove an event banner. */
export async function deleteEvent(supabase: DbClient, eventId: string) {
  const { error } = await supabase
    .from("sched_event")
    .delete()
    .eq("id", eventId);
  return { error };
}
