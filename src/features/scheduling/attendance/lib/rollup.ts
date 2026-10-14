import {
  effectiveAttendance,
  gridName,
  reliabilityScore,
  type AttendanceStatus,
} from "@/lib/schedule/types";
import { emptyTally } from "@/features/scheduling/attendance/lib/tally";
import type { AttendanceRow } from "@/features/scheduling/attendance/types/attendance-row";
import type { EmployeeAttendance } from "@/features/scheduling/attendance/types/employee-attendance";

/**
 * Roll the published-week rows up per employee: one tally each, every shift
 * resolved with `effectiveAttendance()` (a manager's mark wins, else the
 * time-clock grade in `system`, else Present once the day has passed), then a
 * reliability score. Sorted so the people who need attention come first:
 * resolved employees by score ascending (most at-risk first), then anyone with
 * nothing resolved yet, by name.
 */
export function rollupAttendanceByEmployee(
  rows: AttendanceRow[],
  system: Record<string, AttendanceStatus>,
): EmployeeAttendance[] {
  // Roll up per employee.
  const byPerson = new Map<string, EmployeeAttendance>();
  for (const row of rows) {
    if (!row.person) continue;
    const id = row.person.id;
    if (!byPerson.has(id)) {
      byPerson.set(id, {
        personId: id,
        name: gridName(row.person),
        tally: emptyTally(),
        score: null,
      });
    }
    const entry = byPerson.get(id)!;
    const status = effectiveAttendance(
      row.assignment,
      row.published,
      undefined,
      system[row.assignment.id],
    ) as AttendanceStatus;
    entry.tally[status] += 1;
    if (status !== "scheduled") entry.tally.total += 1;
  }

  return [...byPerson.values()]
    .map((e) => ({ ...e, score: reliabilityScore(e.tally) }))
    .sort((a, b) => {
      // Resolved employees first, then by score ascending (most at-risk first).
      if (a.score == null && b.score == null) return a.name.localeCompare(b.name);
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return a.score - b.score;
    });
}
