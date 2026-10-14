import type { AttendanceStatus, ReliabilityTally } from "@/lib/schedule/types";

/** A single resolved shift for one employee, for the HR Attendance tab. */
export interface PersonAttendanceRecord {
  assignmentId: string;
  work_date: string;
  week_start: string;
  status: AttendanceStatus;
  note: string | null;
  location_name: string | null;
  auto_absent: boolean;
}

export interface PersonAttendanceSummary {
  tally: ReliabilityTally;
  score: number | null;
  records: PersonAttendanceRecord[];
}
