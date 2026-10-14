// Punches → work sessions and daily totals — pure. No rounding (exact
// milliseconds): California case law disfavours rounding meal punches.

import { STALE_SESSION_HOURS, type PunchType } from "./state";

export interface Punch {
  id: string;
  punch_type: PunchType;
  punched_at: string;
  work_date: string;
  location_id: string | null;
}

export type SessionStatus =
  /** Clocked in and out. */
  | "complete"
  /** Still clocked in (or on lunch) and not stale. */
  | "open"
  /** Never clocked out — needs a correction. */
  | "missing_clock_out"
  /** Punches without a clock-in — needs a correction. */
  | "missing_clock_in";

export interface LunchBreak {
  start: string;
  /** null while on lunch; a clock-out during lunch ends it. */
  end: string | null;
}

export interface WorkSession<P extends Punch = Punch> {
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  lunches: LunchBreak[];
  punches: P[];
  status: SessionStatus;
  /** Worked time (excluding lunch). null when the session is incomplete. */
  worked_ms: number | null;
  lunch_ms: number;
  location_id: string | null;
}

const ms = (iso: string) => new Date(iso).getTime();

function newSession<P extends Punch>(p: P, withClockIn: boolean): WorkSession<P> {
  return {
    work_date: p.work_date,
    clock_in: withClockIn ? p.punched_at : null,
    clock_out: null,
    lunches: [],
    punches: [],
    status: withClockIn ? "open" : "missing_clock_in",
    worked_ms: null,
    lunch_ms: 0,
    location_id: p.location_id,
  };
}

/**
 * Group punches into sessions (one clock-in … clock-out each; several per day
 * for split shifts). `now` decides whether an unfinished session is still in
 * progress or abandoned.
 */
export function buildSessions<P extends Punch>(punches: readonly P[], now: Date = new Date()): WorkSession<P>[] {
  const sorted = [...punches].sort((a, b) => ms(a.punched_at) - ms(b.punched_at));
  const sessions: WorkSession<P>[] = [];
  let current: WorkSession<P> | null = null;

  const close = (s: WorkSession<P>) => {
    const lastLunch = s.lunches[s.lunches.length - 1];
    if (lastLunch && lastLunch.end === null && s.clock_out) lastLunch.end = s.clock_out;
    s.lunch_ms = s.lunches.reduce((t, l) => t + (l.end ? ms(l.end) - ms(l.start) : 0), 0);
  };

  for (const p of sorted) {
    if (p.punch_type === "clock_in") {
      if (current) {
        if (current.status === "open") current.status = "missing_clock_out";
        close(current);
      }
      current = newSession(p, true);
      current.punches.push(p);
      sessions.push(current);
      continue;
    }
    if (!current) {
      current = newSession(p, false);
      sessions.push(current);
    }
    current.punches.push(p);
    if (p.punch_type === "lunch_start") {
      current.lunches.push({ start: p.punched_at, end: null });
    } else if (p.punch_type === "lunch_end") {
      const open = current.lunches.find((l) => l.end === null);
      if (open) open.end = p.punched_at;
    } else if (p.punch_type === "clock_out") {
      current.clock_out = p.punched_at;
      if (current.status === "open") current.status = "complete";
      close(current);
      current = null;
    }
  }

  if (current && current.status === "open") {
    const last = current.punches[current.punches.length - 1];
    if (now.getTime() - ms(last.punched_at) > STALE_SESSION_HOURS * 3_600_000) {
      current.status = "missing_clock_out";
    }
    close(current);
  }

  for (const s of sessions) {
    if (s.status === "complete" && s.clock_in && s.clock_out) {
      s.worked_ms = ms(s.clock_out) - ms(s.clock_in) - s.lunch_ms;
    } else if (s.status === "open" && s.clock_in) {
      // In progress: count to now, minus completed lunches and any lunch under way.
      const runningLunch = s.lunches.reduce(
        (t, l) => t + (l.end ? 0 : now.getTime() - ms(l.start)),
        0,
      );
      s.worked_ms = now.getTime() - ms(s.clock_in) - s.lunch_ms - runningLunch;
    }
  }
  return sessions;
}

export interface DayTotal<P extends Punch = Punch> {
  work_date: string;
  sessions: WorkSession<P>[];
  /** Sum of complete (and in-progress) sessions. */
  worked_ms: number;
  lunch_ms: number;
  /** At least one session needs a correction. */
  needs_correction: boolean;
}

/** Sessions grouped by work date, newest first. */
export function dayTotals<P extends Punch>(sessions: readonly WorkSession<P>[]): DayTotal<P>[] {
  const byDate = new Map<string, DayTotal<P>>();
  for (const s of sessions) {
    const day = byDate.get(s.work_date) ?? {
      work_date: s.work_date,
      sessions: [],
      worked_ms: 0,
      lunch_ms: 0,
      needs_correction: false,
    };
    day.sessions.push(s);
    day.worked_ms += s.worked_ms ?? 0;
    day.lunch_ms += s.lunch_ms;
    if (s.status === "missing_clock_in" || s.status === "missing_clock_out") day.needs_correction = true;
    byDate.set(s.work_date, day);
  }
  return [...byDate.values()].sort((a, b) => (a.work_date < b.work_date ? 1 : -1));
}

/** "7h 31m" */
export function formatDuration(msValue: number): string {
  const totalMinutes = Math.max(0, Math.floor(msValue / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Decimal hours to two places, as payroll shows them ("7.52"). */
export function decimalHours(msValue: number): string {
  return (Math.max(0, msValue) / 3_600_000).toFixed(2);
}

// ---------------------------------------------------------------------------
// Effective punches (migration 0241): punches − voids + approver adds.
// ---------------------------------------------------------------------------

export interface RawPunch extends Punch {
  location_check: string;
  needs_approval: boolean;
  /** The shift the clock-in was matched to (later punches inherit it). */
  assignment_id?: string | null;
}

export interface PunchAdjustment {
  id: string;
  action: "add" | "void";
  punch_type: PunchType | null;
  punched_at: string | null;
  work_date: string;
  voids_punch_id: string | null;
  voids_adjustment_id: string | null;
  reason: string;
  created_at: string;
}

export interface PunchReview {
  punch_id: string;
  decision: "approved" | "rejected";
}

export type PunchApproval = "none" | "pending" | "approved";

export interface EffectivePunch extends Punch {
  /** "adjustment" = added by an approver (or an approved correction). */
  origin: "punch" | "adjustment";
  /** Off-site punches wait for an approver; everything else is "none". */
  approval: PunchApproval;
  location_check: string;
  /** Why an approver added it. */
  reason: string | null;
  assignment_id: string | null;
}

/**
 * The timecard's punches: recorded punches not voided, plus approver adds not
 * voided. Rejected off-site punches are voided in the database, so they drop
 * out here.
 */
export function effectivePunches(
  punches: readonly RawPunch[],
  adjustments: readonly PunchAdjustment[],
  reviews: readonly PunchReview[],
): EffectivePunch[] {
  const voidedPunches = new Set(adjustments.filter((a) => a.action === "void" && a.voids_punch_id).map((a) => a.voids_punch_id));
  const voidedAdds = new Set(adjustments.filter((a) => a.action === "void" && a.voids_adjustment_id).map((a) => a.voids_adjustment_id));
  const decided = new Map(reviews.map((r) => [r.punch_id, r.decision]));

  const fromPunches: EffectivePunch[] = punches
    .filter((p) => !voidedPunches.has(p.id))
    .map((p) => ({
      id: p.id,
      punch_type: p.punch_type,
      punched_at: p.punched_at,
      work_date: p.work_date,
      location_id: p.location_id,
      origin: "punch",
      approval: !p.needs_approval ? "none" : decided.get(p.id) === "approved" ? "approved" : "pending",
      location_check: p.location_check,
      reason: null,
      assignment_id: p.assignment_id ?? null,
    }));
  const fromAdds: EffectivePunch[] = adjustments
    .filter((a) => a.action === "add" && a.punch_type && a.punched_at && !voidedAdds.has(a.id))
    .map((a) => ({
      id: a.id,
      punch_type: a.punch_type as PunchType,
      punched_at: a.punched_at as string,
      work_date: a.work_date,
      location_id: null,
      origin: "adjustment",
      approval: "none",
      location_check: "not_checked",
      reason: a.reason,
      assignment_id: null,
    }));
  return [...fromPunches, ...fromAdds].sort((a, b) => ms(a.punched_at) - ms(b.punched_at));
}
