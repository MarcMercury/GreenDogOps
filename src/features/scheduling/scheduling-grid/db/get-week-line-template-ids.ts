import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Which Dept/Shift Template rows a week's lines were snapshotted from. */
export async function getWeekLineTemplateIds(
  supabase: DbClient,
  weekId: string,
): Promise<{ template_id: string | null }[]> {
  const { data } = await supabase
    .from("sched_week_line")
    .select("template_id")
    .eq("week_id", weekId);
  return (data ?? []) as { template_id: string | null }[];
}
