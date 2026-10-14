import type { AttendanceShift } from "@/lib/timeclock/attendance-server";
import { formatShiftTime } from "@/lib/timeclock/shift-match";

/** "8:00 AM – 5:00 PM"; just the start when the line has no end; "No time set" when it has neither. */
export function shiftTime(s: Pick<AttendanceShift, "start_time" | "end_time">): string {
  const start = formatShiftTime(s.start_time);
  if (!start) return "No time set";
  return `${start}${s.end_time ? ` – ${formatShiftTime(s.end_time)}` : ""}`;
}
