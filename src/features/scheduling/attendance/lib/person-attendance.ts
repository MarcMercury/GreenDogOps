import {
  effectiveAttendance,
  reliabilityScore,
  type AttendanceStatus,
  type SchedAssignment,
} from "@/lib/schedule/types";
import { emptyTally } from "@/features/scheduling/attendance/lib/tally";
import type {
  LocationLookupRow,
  WeekLookupRow,
} from "@/features/scheduling/attendance/types/lookup-rows";
import type {
  PersonAttendanceRecord,
  PersonAttendanceSummary,
} from "@/features/scheduling/attendance/types/person-attendance";

/**
 * Tally one employee's shifts and list the resolved ones. Mirrors the
 * Scheduling → Attendance & Reliability rollup, scoped to one person: a shift
 * resolves once its week is published and its day has passed (or a manager
 * marked it), an unmarked shift takes the time-clock grade in `system` when
 * one is given, and shifts still "scheduled" are tallied but not listed.
 */
export function summarizePersonAttendance(
  assignments: SchedAssignment[],
  weeks: WeekLookupRow[],
  locations: LocationLookupRow[],
  system: Record<string, AttendanceStatus>,
): PersonAttendanceSummary {
  const weekById = new Map(weeks.map((w) => [w.id, w]));
  const locById = new Map(locations.map((l) => [l.id, l]));

  const tally = emptyTally();
  const records: PersonAttendanceRecord[] = [];

  for (const a of assignments) {
    const week = weekById.get(a.week_id);
    const published = week?.status === "published";
    const status = effectiveAttendance(a, published, undefined, system[a.id]) as AttendanceStatus;
    tally[status] += 1;
    if (status !== "scheduled") tally.total += 1;

    // Only surface resolved shifts (skip future/unmarked "scheduled").
    if (status === "scheduled") continue;
    const loc = locById.get(a.location_id);
    records.push({
      assignmentId: a.id,
      work_date: a.work_date,
      week_start: week?.week_start ?? "",
      status,
      note: a.attendance_note,
      location_name:
        loc?.display_name || loc?.name || loc?.short_code || null,
      auto_absent: a.auto_absent,
    });
  }

  return { tally, score: reliabilityScore(tally), records };
}
