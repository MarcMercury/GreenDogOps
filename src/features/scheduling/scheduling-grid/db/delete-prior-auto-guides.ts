import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/**
 * Remove any prior auto-generated guide for this exact week/loc/dept/day so a
 * regenerate replaces it (cascade drops its columns + slots).
 */
export async function deletePriorAutoGuides(
  supabase: DbClient,
  args: { weekId: string; locationId: string; departmentId: string; day: number },
): Promise<void> {
  const { data: prior } = await supabase
    .from("planning_guide")
    .select("id, weekdays")
    .eq("source_week_id", args.weekId)
    .eq("location_id", args.locationId)
    .eq("department_id", args.departmentId)
    .eq("auto_generated", true);
  const priorIds = ((prior ?? []) as { id: string; weekdays: number[] }[])
    .filter((p) => (p.weekdays ?? []).includes(args.day))
    .map((p) => p.id);
  if (priorIds.length) {
    await supabase.from("planning_guide").delete().in("id", priorIds);
  }
}
