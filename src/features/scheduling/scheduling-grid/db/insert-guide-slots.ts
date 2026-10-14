import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Insert a guide's slot skeleton. */
export async function insertGuideSlots(
  supabase: DbClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  await supabase.from("planning_guide_slot").insert(rows);
}
