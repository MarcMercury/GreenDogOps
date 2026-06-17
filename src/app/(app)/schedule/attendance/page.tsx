import { PageHeader } from "../../_components/ui";
import { getAttendanceData } from "../data";
import {
  gridName,
  reliabilityScore,
  type AttendanceStatus,
  type ReliabilityTally,
} from "@/lib/schedule/types";
import { AttendanceTable, type EmployeeAttendance } from "./attendance-table";

export const dynamic = "force-dynamic";

function emptyTally(): ReliabilityTally {
  return {
    total: 0,
    present: 0,
    late: 0,
    late_excused: 0,
    absent: 0,
    absent_excused: 0,
    no_show: 0,
    pto: 0,
    scheduled: 0,
  };
}

export default async function AttendancePage() {
  const { rows } = await getAttendanceData();

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
    const status = row.assignment.attendance_status as AttendanceStatus;
    entry.tally[status] += 1;
    if (status !== "scheduled") entry.tally.total += 1;
  }

  const employees = [...byPerson.values()]
    .map((e) => ({ ...e, score: reliabilityScore(e.tally) }))
    .sort((a, b) => {
      // Resolved employees first, then by score ascending (most at-risk first).
      if (a.score == null && b.score == null) return a.name.localeCompare(b.name);
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return a.score - b.score;
    });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Attendance & Reliability"
        description="Reliability is rolled up from attendance marked on published schedules, including auto-absences."
      />
      <AttendanceTable employees={employees} />
    </div>
  );
}
