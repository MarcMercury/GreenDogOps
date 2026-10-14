import "server-only";
import type { AttendanceStatus } from "@/lib/schedule/types";
import { systemAttendance } from "@/lib/timeclock/attendance-server";
import { todayInWorkTz } from "@/lib/worklist/dates";

/** Time-clock grades never break a page: on failure, fall back to manual marks only. */
export async function getSystemAttendance(
  from: string,
  to: string,
  opts: { personIds?: string[] } = {},
): Promise<Record<string, AttendanceStatus>> {
  try {
    return await systemAttendance(from, to, { ...opts, today: todayInWorkTz() });
  } catch (e) {
    console.error("[attendance] time-clock grades unavailable:", e instanceof Error ? e.message : e);
    return {};
  }
}
