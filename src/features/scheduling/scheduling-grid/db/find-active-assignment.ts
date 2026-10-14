import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/**
 * An active (not removed-post-publish) assignment for a person in a cell, if
 * one exists — used to make assigning twice a no-op and to spot a drag that
 * would duplicate a row. `excludeId` leaves the row being moved out of the check.
 */
export async function findActiveAssignment(
  supabase: DbClient,
  cell: {
    lineId: string;
    locationId: string;
    dayOfWeek: number;
    personId: string;
    excludeId?: string;
  },
): Promise<{ id: string } | null> {
  let q = supabase
    .from("sched_assignment")
    .select("id")
    .eq("line_id", cell.lineId)
    .eq("location_id", cell.locationId)
    .eq("day_of_week", cell.dayOfWeek)
    .eq("person_id", cell.personId)
    .eq("removed_post_publish", false);
  if (cell.excludeId) q = q.neq("id", cell.excludeId);
  const { data } = await q.maybeSingle();
  return (data as { id: string } | null) ?? null;
}
