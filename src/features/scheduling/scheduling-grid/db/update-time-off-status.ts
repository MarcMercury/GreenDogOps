import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Record a decision on a PTO request. */
export async function updateTimeOffStatus(
  supabase: DbClient,
  timeOffId: string,
  decision: {
    status: "approved" | "denied";
    reviewed_by: string | null;
    reviewed_at: string;
  },
) {
  const { error } = await supabase
    .from("person_time_off")
    .update(decision)
    .eq("id", timeOffId);
  return { error };
}
