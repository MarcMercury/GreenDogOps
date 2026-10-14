import "server-only";
import { getAttendanceSettings, gradeRange } from "@/lib/timeclock/attendance-server";
import type { DayAttendance } from "@/features/scheduling/time-attendance/types/day-attendance";

/**
 * One day's live grades. The thresholds and go-live switch are read first
 * because grading depends on them; then every published shift on `date` is
 * graded against the effective punches, and punches that matched no shift come
 * back as unscheduled work.
 */
export async function getDayAttendance(date: string): Promise<DayAttendance> {
  const settings = await getAttendanceSettings();
  const { graded, unscheduled } = await gradeRange(date, date, { settings });
  return { settings, graded, unscheduled };
}
