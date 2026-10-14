import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { SchedAssignment } from "@/lib/schedule/types";
import { todayInWorkTz } from "@/lib/worklist/dates";
import { getLocationLookupRows } from "@/features/scheduling/setup/db/get-location-lookup-rows";
import { getSystemAttendance } from "@/features/scheduling/attendance/db/get-system-attendance";
import { getWeekLookupRows } from "@/features/scheduling/attendance/db/get-week-lookup-rows";
import { summarizePersonAttendance } from "@/features/scheduling/attendance/lib/person-attendance";
import type { PersonAttendanceSummary } from "@/features/scheduling/attendance/types/person-attendance";

/**
 * Attendance rolled up for a single employee from published schedules.
 * Mirrors the Scheduling → Attendance & Reliability view, scoped to one person.
 */
export async function getPersonAttendance(
  personId: string,
): Promise<PersonAttendanceSummary> {
  const supabase = await createClient();
  const [asgRes, weeks, locs] = await Promise.all([
    fetchAllRows<SchedAssignment>((from, to) =>
      supabase
        .from("sched_assignment")
        .select("*")
        .eq("person_id", personId)
        .order("work_date", { ascending: false })
        .range(from, to),
    ),
    getWeekLookupRows(),
    getLocationLookupRows(),
  ]);
  const system = await getSystemAttendance("1970-01-01", todayInWorkTz(), { personIds: [personId] });

  return summarizePersonAttendance(asgRes.data as SchedAssignment[], weeks, locs, system);
}
