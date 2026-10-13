// Automatic attendance (go-live item 16, plan §C) — pure. Grades each published
// shift from the person's effective punches. Nothing is stored: the punches
// are the facts and a manager's manual attendance mark is the override.

import type { AttendanceStatus } from "../schedule/types";
import { addDays } from "../worklist/dates";
import { localToInstant } from "./local-time";
import type { Punch, WorkSession } from "./timecard";

export interface AttendanceThresholds {
  lateGraceMinutes: number;
  veryLateMinutes: number;
  missedAfterMinutes: number;
  leftEarlyMinutes: number;
}

export const DEFAULT_THRESHOLDS: AttendanceThresholds = {
  lateGraceMinutes: 5,
  veryLateMinutes: 15,
  missedAfterMinutes: 60,
  leftEarlyMinutes: 10,
};

export type ShiftState =
  /** Approved time off that day. */
  | "pto"
  /** The shift hasn't started and nobody has clocked in. */
  | "upcoming"
  /** Started, no clock-in yet, still inside the missed window. */
  | "not_in_yet"
  /** No clock-in by the missed window (or by the end of the day for an untimed shift). */
  | "missed"
  /** Clocked in, not out yet. */
  | "working"
  /** Clocked in but never out (a correction is needed). */
  | "incomplete"
  /** Clocked out more than the threshold before the shift ended. */
  | "left_early"
  | "completed";

export const SHIFT_STATE_LABELS: Record<ShiftState, string> = {
  pto: "PTO",
  upcoming: "Upcoming",
  not_in_yet: "Not in yet",
  missed: "Missed",
  working: "Working",
  incomplete: "No clock-out",
  left_early: "Left early",
  completed: "Completed",
};

export type LateLevel = "late" | "very_late" | null;

export interface ShiftInput {
  assignment_id: string;
  person_id: string;
  work_date: string;
  location_id: string;
  start_time: string | null;
  end_time: string | null;
}

export interface GradedShift<S extends ShiftInput = ShiftInput, P extends SessionPunch = SessionPunch> {
  shift: S;
  state: ShiftState;
  lateLevel: LateLevel;
  /** Minutes after the shift start the person clocked in (negative = early). */
  lateMinutes: number | null;
  /** Minutes before the shift end the person clocked out. */
  leftEarlyMinutes: number | null;
  session: WorkSession<P> | null;
}

/** What the grading needs from a punch (EffectivePunch satisfies it). */
export interface SessionPunch extends Punch {
  /** The shift the clock-in was matched to. */
  assignment_id?: string | null;
}

export interface ShiftWindow {
  start: Date | null;
  end: Date | null;
}

/** The shift's start and end instants (an end at or before the start is the next day). */
export function shiftWindow(s: Pick<ShiftInput, "work_date" | "start_time" | "end_time">, timeZone: string): ShiftWindow {
  const start = s.start_time ? localToInstant(s.work_date, s.start_time.slice(0, 5), timeZone) : null;
  let end: Date | null = null;
  if (s.end_time) {
    const overnight = s.start_time !== null && s.end_time <= s.start_time;
    end = localToInstant(overnight ? addDays(s.work_date, 1) : s.work_date, s.end_time.slice(0, 5), timeZone);
  }
  return { start, end };
}

const minutesBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 60_000);

/**
 * Match one person's sessions to their shifts: a session whose clock-in was
 * matched to a shift goes to that shift; the rest go to the unmatched shift
 * on the same work date with the nearest start. Unmatched sessions are
 * unscheduled work.
 */
export function matchSessions<S extends ShiftInput, P extends SessionPunch>(
  shifts: readonly S[],
  sessions: readonly WorkSession<P>[],
  timeZone: string,
): { bySession: Map<string, WorkSession<P>>; unscheduled: WorkSession<P>[] } {
  const bySession = new Map<string, WorkSession<P>>();
  const remaining: WorkSession<P>[] = [];
  const ids = new Set(shifts.map((s) => s.assignment_id));
  for (const sess of sessions) {
    const assigned = sess.punches.find((p) => p.punch_type === "clock_in")?.assignment_id ?? null;
    if (assigned && ids.has(assigned) && !bySession.has(assigned)) bySession.set(assigned, sess);
    else remaining.push(sess);
  }
  const unscheduled: WorkSession<P>[] = [];
  for (const sess of remaining) {
    const at = sess.clock_in ? new Date(sess.clock_in) : new Date(sess.punches[0].punched_at);
    const candidates = shifts
      .filter((s) => s.work_date === sess.work_date && !bySession.has(s.assignment_id))
      .map((s) => {
        const w = shiftWindow(s, timeZone);
        return { s, d: w.start ? Math.abs(at.getTime() - w.start.getTime()) : Number.MAX_SAFE_INTEGER };
      })
      .sort((a, b) => a.d - b.d);
    if (candidates.length > 0) bySession.set(candidates[0].s.assignment_id, sess);
    else unscheduled.push(sess);
  }
  return { bySession, unscheduled };
}

/** Grade one shift. */
export function gradeShift<S extends ShiftInput, P extends SessionPunch>(
  shift: S,
  session: WorkSession<P> | null,
  opts: { now: Date; timeZone: string; thresholds: AttendanceThresholds; onPto: boolean },
): GradedShift<S, P> {
  const { now, timeZone, thresholds: t } = opts;
  const w = shiftWindow(shift, timeZone);
  const base = { shift, session, lateLevel: null as LateLevel, lateMinutes: null as number | null, leftEarlyMinutes: null as number | null };

  if (!session || !session.clock_in) {
    if (opts.onPto) return { ...base, state: "pto" };
    if (w.start) {
      if (now < w.start) return { ...base, state: "upcoming" };
      if (minutesBetween(now, w.start) < t.missedAfterMinutes) return { ...base, state: "not_in_yet" };
      return { ...base, state: "missed" };
    }
    // Untimed shift: missed once the work day is over.
    const dayOver = localToInstant(addDays(shift.work_date, 1), "00:00", timeZone);
    return { ...base, state: dayOver && now >= dayOver ? "missed" : "upcoming" };
  }

  const clockIn = new Date(session.clock_in);
  let lateMinutes: number | null = null;
  let lateLevel: LateLevel = null;
  if (w.start) {
    lateMinutes = minutesBetween(clockIn, w.start);
    if (lateMinutes > t.veryLateMinutes) lateLevel = "very_late";
    else if (lateMinutes > t.lateGraceMinutes) lateLevel = "late";
  }

  if (session.status === "missing_clock_out" || session.status === "missing_clock_in") {
    return { ...base, state: "incomplete", lateMinutes, lateLevel };
  }
  if (!session.clock_out) return { ...base, state: "working", lateMinutes, lateLevel };

  const clockOut = new Date(session.clock_out);
  if (w.end) {
    const early = minutesBetween(w.end, clockOut);
    if (early > t.leftEarlyMinutes) {
      return { ...base, state: "left_early", lateMinutes, lateLevel, leftEarlyMinutes: early };
    }
  }
  return { ...base, state: "completed", lateMinutes, lateLevel };
}

/**
 * The attendance status a grade stands for, for reliability and the grid.
 * Missed counts as Absent (a manager can mark No-show); not-yet-due shifts
 * stay Scheduled. Left early and a missing clock-out still count as present —
 * they are timecard issues.
 */
export function gradeToAttendance(g: Pick<GradedShift, "state" | "lateLevel">): AttendanceStatus {
  if (g.state === "pto") return "pto";
  if (g.state === "missed") return "absent";
  if (g.state === "upcoming" || g.state === "not_in_yet") return "scheduled";
  return g.lateLevel ? "late" : "present";
}

/** Should time-clock grades count for this shift? (`from` = timeclock.attendance_from.) */
export function attendanceLiveFor(workDate: string, from: string | null): boolean {
  return !!from && workDate >= from;
}
