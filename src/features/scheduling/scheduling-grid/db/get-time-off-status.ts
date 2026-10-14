import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** A PTO request's current status, or null when it no longer exists. */
export async function getTimeOffStatus(
  supabase: DbClient,
  timeOffId: string,
): Promise<{ status: string } | null> {
  const { data } = await supabase
    .from("person_time_off")
    .select("status")
    .eq("id", timeOffId)
    .maybeSingle();
  return (data as { status: string } | null) ?? null;
}
