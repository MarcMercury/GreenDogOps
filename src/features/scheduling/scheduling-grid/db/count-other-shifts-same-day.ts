import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** How many other active shifts the person still has on the same date of the week. */
export async function countOtherShiftsSameDay(
  supabase: DbClient,
  args: { weekId: string; personId: string; workDate: string; excludeId: string },
): Promise<number> {
  const { data: others } = await supabase
    .from("sched_assignment")
    .select("id")
    .eq("week_id", args.weekId)
    .eq("person_id", args.personId)
    .eq("work_date", args.workDate)
    .eq("removed_post_publish", false)
    .neq("id", args.excludeId);
  return (others ?? []).length;
}
