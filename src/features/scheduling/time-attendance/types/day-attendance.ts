import type { AttendanceSettings, UnscheduledWork } from "@/lib/timeclock/attendance-server";
import type { GradedRow } from "@/features/scheduling/time-attendance/types/graded-row";

/** Everything Scheduling ▸ Time & Attendance shows for one day. */
export interface DayAttendance {
  /** The go-live switch and lateness thresholds from Admin ▸ Settings ▸ Time clock. */
  settings: AttendanceSettings;
  /** Every published shift that day, graded against the effective punches. */
  graded: GradedRow[];
  /** Sessions that day that matched no published shift. */
  unscheduled: UnscheduledWork[];
}
