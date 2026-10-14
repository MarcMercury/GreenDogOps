import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SchedPerson } from "@/lib/schedule/types";
import { todayInWorkTz } from "@/lib/worklist/dates";
import { PERSON_COLS } from "@/features/scheduling/shared/db/person-columns";
import { fetchAllAssignmentsForWeeks } from "@/features/scheduling/attendance/db/fetch-all-assignments-for-weeks";
import { getSystemAttendance } from "@/features/scheduling/attendance/db/get-system-attendance";
import type { AttendanceData } from "@/features/scheduling/attendance/types/attendance-data";
import type { AttendanceRow } from "@/features/scheduling/attendance/types/attendance-row";
import type { WeekLookupRow } from "@/features/scheduling/attendance/types/lookup-rows";

/** Resolved-attendance assignments across published weeks, for the rollup. */
export async function getAttendanceData(): Promise<AttendanceData> {
  const supabase = await createClient();
  const [weekRes, peopleRes] = await Promise.all([
    supabase
      .from("sched_week")
      .select("id, week_start, status")
      .eq("status", "published"),
    supabase
      .from("person")
      .select(PERSON_COLS)
      .in("status", ["employee", "contractor"])
      .order("last_name"),
  ]);

  const people = (peopleRes.data ?? []) as SchedPerson[];
  const personById = new Map(people.map((p) => [p.id, p]));
  const weeks = (weekRes.data ?? []) as WeekLookupRow[];
  const weekById = new Map(weeks.map((w) => [w.id, w]));

  const assignments = await fetchAllAssignmentsForWeeks(
    supabase,
    weeks.map((w) => w.id),
  );

  const rows: AttendanceRow[] = assignments.map((a) => {
    const week = weekById.get(a.week_id);
    return {
      assignment: a,
      person: personById.get(a.person_id) ?? null,
      week_start: week?.week_start ?? "",
      published: true,
    };
  });

  const system = await getSystemAttendance("1970-01-01", todayInWorkTz());
  return { rows, people, system };
}
