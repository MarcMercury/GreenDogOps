import type { AttendanceStatus, SchedPerson } from "@/lib/schedule/types";
import type { AttendanceRow } from "@/features/scheduling/attendance/types/attendance-row";

/** Everything the Attendance & Reliability page loads, from `getAttendanceData()`. */
export interface AttendanceData {
  rows: AttendanceRow[];
  people: SchedPerson[];
  /** Time-clock grades for unmarked shifts, by assignment id. */
  system: Record<string, AttendanceStatus>;
}
