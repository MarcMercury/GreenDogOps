import "server-only";
import { createClient } from "@/lib/supabase/server";
import { dateForDay } from "@/lib/schedule/types";
import type { PersonTimeOff } from "@/lib/hr/types";

/**
 * Time-off requests that overlap a given Sunday-start week. Drives the
 * scheduler's color coding (requested = amber, approved = green).
 */
export async function getWeekTimeOff(
  weekStart: string,
): Promise<PersonTimeOff[]> {
  const supabase = await createClient();
  const weekEnd = dateForDay(weekStart, 6);
  const { data } = await supabase
    .from("person_time_off")
    .select("*")
    .in("status", ["requested", "approved"])
    .lte("start_date", weekEnd)
    .gte("end_date", weekStart);
  return (data ?? []) as PersonTimeOff[];
}
