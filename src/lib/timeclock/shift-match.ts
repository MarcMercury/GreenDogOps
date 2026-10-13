// Which published shift a clock-in belongs to — pure. With several shifts on
// the day (split shifts, multiple cells), pick the one whose start is nearest
// to now; shifts without a start time sort last. No shift = unscheduled work,
// which is allowed.

export interface ShiftCandidate {
  assignment_id: string;
  location_id: string;
  start_time: string | null;
  end_time: string | null;
}

function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Minutes since local midnight in `timeZone`. */
export function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function pickShift<T extends ShiftCandidate>(shifts: readonly T[], nowMinutes: number): T | null {
  if (shifts.length === 0) return null;
  const scored = shifts.map((s) => ({
    s,
    d: s.start_time ? Math.abs(minutesOf(s.start_time) - nowMinutes) : Number.POSITIVE_INFINITY,
  }));
  scored.sort((a, b) => a.d - b.d);
  return scored[0].s;
}

/** "08:00:00" → "8:00 AM" */
export function formatShiftTime(t: string | null): string | null {
  if (!t) return null;
  const mins = minutesOf(t);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}
