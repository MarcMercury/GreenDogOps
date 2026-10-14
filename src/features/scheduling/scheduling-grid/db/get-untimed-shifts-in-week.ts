import "server-only";
import { untimedShifts, type ShiftForCheck } from "@/lib/schedule/publish";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** Shifts on the week whose line has no start or end time (go-live item 9). */
export async function getUntimedShiftsInWeek(
  supabase: DbClient,
  weekId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("sched_assignment")
    .select("work_date, removed_post_publish, sched_week_line(label, start_time, end_time), person(full_name, first_name, last_name, preferred_name)")
    .eq("week_id", weekId)
    .eq("removed_post_publish", false)
    .limit(5000);
  type Row = {
    work_date: string;
    sched_week_line: { label: string | null; start_time: string | null; end_time: string | null } | null;
    person: { full_name: string | null; first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
  };
  const rows: ShiftForCheck[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    work_date: r.work_date,
    person_name:
      [r.person?.preferred_name || r.person?.first_name, r.person?.last_name].filter(Boolean).join(" ") ||
      r.person?.full_name ||
      "Unknown",
    line_label: r.sched_week_line?.label ?? null,
    start_time: r.sched_week_line?.start_time ?? null,
    end_time: r.sched_week_line?.end_time ?? null,
  }));
  return untimedShifts(rows);
}
