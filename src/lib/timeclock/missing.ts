// When is a clock-out overdue? Pure. Used by the notification producer that
// reminds an employee (and their clinic's managers) to fix a missing clock-out.

import { addDays } from "../worklist/dates";
import { localToInstant } from "./local-time";

/** Grace after the scheduled end before a still-open session is flagged. */
export const MISSING_CLOCK_OUT_GRACE_MINUTES = 60;
/** With no scheduled end, a session open this long is flagged. */
export const MISSING_CLOCK_OUT_UNSCHEDULED_HOURS = 12;
/** Sessions older than this are no longer reminded about (they're in the queue). */
export const MISSING_CLOCK_OUT_MAX_AGE_DAYS = 7;

export interface OpenSession {
  clockInAt: string;
  workDate: string;
  /** Scheduled shift times ("HH:MM:SS"), when the clock-in matched a shift. */
  shiftStart: string | null;
  shiftEnd: string | null;
}

/** The moment the session counts as "forgot to clock out", or null if it never will be checked. */
export function clockOutDueAt(s: OpenSession, timeZone: string): Date | null {
  if (s.shiftEnd) {
    // An end time at or before the start time is an overnight shift.
    const overnight = s.shiftStart !== null && s.shiftEnd <= s.shiftStart;
    const end = localToInstant(overnight ? addDays(s.workDate, 1) : s.workDate, s.shiftEnd.slice(0, 5), timeZone);
    if (end) return new Date(end.getTime() + MISSING_CLOCK_OUT_GRACE_MINUTES * 60_000);
  }
  return new Date(new Date(s.clockInAt).getTime() + MISSING_CLOCK_OUT_UNSCHEDULED_HOURS * 3_600_000);
}

export function isClockOutOverdue(s: OpenSession, now: Date, timeZone: string): boolean {
  const age = now.getTime() - new Date(s.clockInAt).getTime();
  if (age > MISSING_CLOCK_OUT_MAX_AGE_DAYS * 86_400_000) return false;
  const due = clockOutDueAt(s, timeZone);
  return !!due && now.getTime() >= due.getTime();
}
