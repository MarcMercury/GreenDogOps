import type {
  AttendanceStatus,
  SchedAssignment,
  SchedClosure,
  SchedEvent,
  SchedWeek,
  SchedWeekLine,
  SchedWeekLocation,
} from "@/lib/schedule/types";

/** Full grid payload for one week (or one Week Template). */
export interface WeekData {
  week: SchedWeek;
  lines: SchedWeekLine[];
  weekLocations: SchedWeekLocation[];
  closures: SchedClosure[];
  events: SchedEvent[];
  assignments: SchedAssignment[];
  /** Time-clock grades for unmarked shifts, by assignment id (empty until attendance goes live). */
  systemAttendance?: Record<string, AttendanceStatus>;
}
