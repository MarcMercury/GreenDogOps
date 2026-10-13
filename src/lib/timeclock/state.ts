// Time-clock state machine — pure. The database function record_time_punch()
// (migration 0240) enforces the same rules and is authoritative; this copy
// drives the buttons in /me and is pinned by state.test.ts.

export const PUNCH_TYPES = ["clock_in", "lunch_start", "lunch_end", "clock_out"] as const;
export type PunchType = (typeof PUNCH_TYPES)[number];

export type ClockState = "off" | "working" | "on_lunch";

/** A session idle longer than this is abandoned (a missing clock-out). */
export const STALE_SESSION_HOURS = 16;
/**
 * Someone who forgot to clock out may start a new shift once their last punch
 * is older than this (record_time_punch p_abandon_previous, migration 0241).
 */
export const ABANDON_AFTER_HOURS = 8;
/** The same punch repeated within this window is a double tap, not a new punch. */
export const DUPLICATE_WINDOW_SECONDS = 60;
/** How far back an employee may request a correction to their own punches. */
export const CORRECTION_WINDOW_DAYS = 45;

export const PUNCH_LABELS: Record<PunchType, string> = {
  clock_in: "Clock in",
  lunch_start: "Start lunch",
  lunch_end: "End lunch",
  clock_out: "Clock out",
};

export function isPunchType(v: unknown): v is PunchType {
  return typeof v === "string" && (PUNCH_TYPES as readonly string[]).includes(v);
}

export interface LastPunch {
  punch_type: PunchType;
  punched_at: string;
}

/** The person's clock state given their most recent punch. */
export function clockState(last: LastPunch | null, now: Date = new Date()): ClockState {
  if (!last || last.punch_type === "clock_out") return "off";
  const idleMs = now.getTime() - new Date(last.punched_at).getTime();
  if (idleMs > STALE_SESSION_HOURS * 3_600_000) return "off";
  return last.punch_type === "lunch_start" ? "on_lunch" : "working";
}

const ALLOWED: Record<ClockState, readonly PunchType[]> = {
  off: ["clock_in"],
  working: ["lunch_start", "clock_out"],
  on_lunch: ["lunch_end", "clock_out"],
};

/** Punches the person may make next, in the order the buttons appear. */
export function allowedPunches(state: ClockState): readonly PunchType[] {
  return ALLOWED[state];
}

export function canPunch(state: ClockState, type: PunchType): boolean {
  return ALLOWED[state].includes(type);
}

/** Last punch is open and stale: the person forgot to clock out. */
export function hasAbandonedSession(last: LastPunch | null, now: Date = new Date()): boolean {
  return !!last && last.punch_type !== "clock_out" && clockState(last, now) === "off";
}

/**
 * Still "working" or "on lunch" from a punch more than ABANDON_AFTER_HOURS ago:
 * offer "I forgot to clock out — start a new shift".
 */
export function canStartNewShift(last: LastPunch | null, now: Date = new Date()): boolean {
  const state = clockState(last, now);
  if (!last || state === "off") return false;
  return now.getTime() - new Date(last.punched_at).getTime() > ABANDON_AFTER_HOURS * 3_600_000;
}
