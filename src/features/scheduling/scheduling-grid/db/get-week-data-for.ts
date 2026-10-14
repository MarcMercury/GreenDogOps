import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/worklist/dates";
import type {
  SchedAssignment,
  SchedClosure,
  SchedEvent,
  SchedWeek,
  SchedWeekLine,
  SchedWeekLocation,
} from "@/lib/schedule/types";
import { getSystemAttendance } from "@/features/scheduling/attendance/db/get-system-attendance";
import type { WeekData } from "@/features/scheduling/scheduling-grid/types/week-data";

/** Full grid payload for a week that has already been loaded.
 *
 * Callers that came from the week list already hold the row, so taking it as an
 * argument removes a lookup from the critical path and lets the caller start
 * the time-off and agenda queries at the same time instead of after it.
 */
export async function getWeekDataFor(week: SchedWeek): Promise<WeekData> {
  const supabase = await createClient();
  const [lineRes, locRes, closeRes, eventRes, asgRes] = await Promise.all([
    supabase
      .from("sched_week_line")
      .select("*")
      .eq("week_id", week.id)
      .order("sort_order"),
    supabase
      .from("sched_week_location")
      .select("*")
      .eq("week_id", week.id)
      .order("sort_order"),
    supabase.from("sched_closure").select("*").eq("week_id", week.id),
    supabase.from("sched_event").select("*").eq("week_id", week.id),
    supabase.from("sched_assignment").select("*").eq("week_id", week.id),
  ]);

  // Time-clock grades for unmarked shifts; never break the page on failure.
  const graded =
    week.status === "published" && !week.is_template
      ? await getSystemAttendance(week.week_start, addDays(week.week_start, 6))
      : {};

  return {
    week,
    lines: (lineRes.data ?? []) as SchedWeekLine[],
    weekLocations: (locRes.data ?? []) as SchedWeekLocation[],
    closures: (closeRes.data ?? []) as SchedClosure[],
    events: (eventRes.data ?? []) as SchedEvent[],
    assignments: (asgRes.data ?? []) as SchedAssignment[],
    systemAttendance: graded,
  };
}
