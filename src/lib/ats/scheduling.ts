// ---------------------------------------------------------------------------
// Interview self-scheduling — the pure parts: turn an interviewer's weekly
// availability + busy times into bookable slots, and format times for the
// candidate. No I/O, so the rules (buffers, notice, time zones, DST) are
// unit-tested; Google free/busy lookups and bookings live in the server code.
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

/** One block of weekly availability in the interviewer's time zone. */
export interface WeeklyWindow {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  /** "HH:MM", 24-hour. */
  start: string;
  end: string;
}

export interface Interval {
  start: Date;
  end: Date;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isTime(v: unknown): v is string {
  return typeof v === "string" && TIME_RE.test(v);
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && DATE_RE.test(v);
}

function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Well-formed windows only (valid day, HH:MM, end after start), sorted. */
export function parseWeeklyHours(raw: unknown): WeeklyWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: WeeklyWindow[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const { day, start, end } = w as Record<string, unknown>;
    if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) continue;
    if (!isTime(start) || !isTime(end) || minutesOf(end) <= minutesOf(start)) continue;
    out.push({ day, start, end });
  }
  return out.sort((a, b) => a.day - b.day || minutesOf(a.start) - minutesOf(b.start));
}

/** Minutes the zone is ahead of UTC at this instant (LA in summer: -420). */
export function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The instant a wall-clock date + time occurs in a time zone. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const first = tzOffsetMinutes(new Date(guess), timeZone);
  let utc = guess - first * 60000;
  const second = tzOffsetMinutes(new Date(utc), timeZone);
  if (second !== first) utc = guess - second * 60000;
  return new Date(utc);
}

/** { date: "2026-10-13", time: "11:30" } for an instant in a time zone. */
export function zonedParts(at: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Calendar dates from..to inclusive ("YYYY-MM-DD"). */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d));
  const [ty, tm, td] = to.split("-").map(Number);
  const end = Date.UTC(ty, tm - 1, td);
  while (cur.getTime() <= end && out.length < 366) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Shift a "YYYY-MM-DD" date by whole days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface SlotOptions {
  windows: WeeklyWindow[];
  timeZone: string;
  /** Inclusive range of calendar dates, in the interviewer's zone. */
  dateFrom: string;
  dateTo: string;
  durationMinutes: number;
  /** Kept clear before and after every busy block. */
  bufferMinutes: number;
  /** No slot may start sooner than this after `now`. */
  minNoticeMinutes: number;
  now: Date;
  busy: Interval[];
  /** Spacing between offered start times; defaults to min(duration, 30). */
  stepMinutes?: number;
}

/**
 * Bookable interview start times: inside the weekly windows, far enough
 * ahead, and clear of every busy block (plus buffer on both sides).
 */
export function computeSlots(o: SlotOptions): Date[] {
  const step = Math.max(5, o.stepMinutes ?? Math.min(o.durationMinutes, 30)) * 60000;
  const dur = o.durationMinutes * 60000;
  const buffer = o.bufferMinutes * 60000;
  const earliest = o.now.getTime() + o.minNoticeMinutes * 60000;
  const busy = o.busy.map((b) => ({ start: b.start.getTime(), end: b.end.getTime() }));
  const seen = new Set<number>();
  const out: Date[] = [];

  for (const date of datesBetween(o.dateFrom, o.dateTo)) {
    const wd = weekdayOf(date);
    for (const w of o.windows) {
      if (w.day !== wd) continue;
      const winStart = zonedTimeToUtc(date, w.start, o.timeZone).getTime();
      const winEnd = zonedTimeToUtc(date, w.end, o.timeZone).getTime();
      for (let t = winStart; t + dur <= winEnd; t += step) {
        if (t < earliest || seen.has(t)) continue;
        const clash = busy.some((b) => t < b.end + buffer && t + dur + buffer > b.start);
        if (clash) continue;
        seen.add(t);
        out.push(new Date(t));
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

export interface SlotDay {
  date: string;
  /** "Tuesday, October 13" */
  label: string;
  times: { iso: string; label: string }[];
}

/** "Tuesday, October 13" */
export function formatLongDate(at: Date, timeZone: string): string {
  return at.toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" });
}

/** "11:30 AM" */
export function formatClock(at: Date, timeZone: string): string {
  return at.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}

/** "PDT" / "PST" */
export function zoneAbbreviation(at: Date, timeZone: string): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone
  );
}

/** Slots grouped by day for the candidate's picker. */
export function groupSlotsByDay(slots: Date[], timeZone: string): SlotDay[] {
  const days = new Map<string, SlotDay>();
  for (const s of slots) {
    const { date } = zonedParts(s, timeZone);
    const day = days.get(date) ?? { date, label: formatLongDate(s, timeZone), times: [] };
    day.times.push({ iso: s.toISOString(), label: formatClock(s, timeZone) });
    days.set(date, day);
  }
  return [...days.values()];
}

// ---------------------------------------------------------------------------
// Calendar file (.ics) for the candidate / interviewer when no Google
// calendar is connected to send the invite.
// ---------------------------------------------------------------------------

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** RFC 5545 line folding at 75 octets. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    if (curLen + len > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
      curLen = 0;
    }
    cur += ch;
    curLen += len;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function buildIcs(e: {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  now?: Date;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Green Dog Ops//Recruiting//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsDate(e.now ?? new Date())}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(e.end)}`,
    `SUMMARY:${icsText(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** How each interview type reads to the candidate. */
export const CANDIDATE_INTERVIEW_TITLES: Record<string, string> = {
  phone_screen: "Phone interview",
  virtual: "Virtual interview",
  in_person: "In-person interview",
  working_interview: "Shadow day",
  final: "Final interview",
  doc_call: "Call with our doctor",
  other: "Interview",
};

export function candidateInterviewTitle(type: string | null | undefined): string {
  return (type && CANDIDATE_INTERVIEW_TITLES[type]) || "Interview";
}

/** Random URL-safe token for candidate links (forms, scheduling). */
export function linkToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
