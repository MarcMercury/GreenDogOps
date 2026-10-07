// ---------------------------------------------------------------------------
// Open-day normalization for the weekly Ops digest. Pure functions (no
// server-only imports) so the arithmetic and wording can be unit-tested; the
// Supabase queries and message assembly live in ./digest.ts.
//
// The problem this module exists to solve: the clinics do not trade a uniform
// seven-day week, so any comparison built on raw calendar days is wrong.
// Everyone is closed Sunday, Sherman Oaks only runs Mon/Wed/Fri, holidays close
// everyone, and a day the ezyVet invoice ingest missed looks identical to a day
// with no business. Each of those silently changes the number of trading days
// behind a total.
// ---------------------------------------------------------------------------

import type { LocationDailyRow } from "./types";

const DAY_MS = 86_400_000;

/** `Date.getUTCDay()` values for Monday–Saturday. Everyone is closed Sunday. */
export const MON_TO_SAT = [1, 2, 3, 4, 5, 6] as const;

export interface ClinicSchedule {
  label: string;
  /** `Date.getUTCDay()` values the clinic sees patients on. */
  openDows: readonly number[];
}

/**
 * The days each clinic actually trades. This is the denominator for every
 * per-open-day average, and it is how a real closure is told apart from a day
 * the ingest missed. Clinics listed here are always printed, even at zero, so
 * one silently dropping out of the warehouse is visible instead of invisible.
 */
export const CLINIC_SCHEDULE: Record<string, ClinicSchedule> = {
  venice: { label: "Venice", openDows: MON_TO_SAT },
  van_nuys: { label: "Van Nuys", openDows: MON_TO_SAT },
  sherman_oaks: { label: "Sherman Oaks", openDows: [1, 3, 5] },
};

export interface Range {
  start: string;
  end: string;
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The most recent complete Monday–Saturday business week as of `today`
 * (YYYY-MM-DD in the clinics' timezone). Run on a Monday this is "last week".
 * Sunday is left out entirely: the clinics are closed, so including it only
 * pads the window with a guaranteed zero on both sides of the comparison.
 */
export function lastCompleteBusinessWeek(today: string): Range {
  const t = Date.parse(`${today}T00:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  // Back up to the Sunday that closed the last complete week, then take the
  // Monday–Saturday that ran up to it.
  const sunday = t - (dow === 0 ? 7 : dow) * DAY_MS;
  const monday = new Date(sunday - 6 * DAY_MS).toISOString().slice(0, 10);
  return { start: monday, end: addDays(monday, 5) };
}

/** Every date in an inclusive range, as YYYY-MM-DD. */
export function datesIn(range: Range): string[] {
  const out: string[] = [];
  const last = Date.parse(`${range.end}T00:00:00Z`);
  for (let t = Date.parse(`${range.start}T00:00:00Z`); t <= last; t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function scheduleFor(key: string): ClinicSchedule {
  return CLINIC_SCHEDULE[key] ?? { label: key, openDows: MON_TO_SAT };
}

/** Is `key` scheduled to be trading on `iso`? */
export function isScheduledOpen(key: string, iso: string): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return scheduleFor(key).openDows.includes(dow);
}

export function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 10_000) return `$${Math.round(v / 1000)}k`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

export function fmtNum(n: number | null | undefined): string {
  return Math.round(Number(n ?? 0)).toLocaleString("en-US");
}

/** `▲ 4.2%`, or `new` when there is no baseline to compare against. */
export function delta(current: number, prior: number): string {
  if (!prior) return current ? "new" : "—";
  const pct = ((current - prior) / prior) * 100;
  if (Math.abs(pct) < 0.05) return "flat";
  return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`;
}

export function monthDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function rangeLabel(r: Range): string {
  return r.start.slice(0, 7) === r.end.slice(0, 7)
    ? `${monthDay(r.start)}–${Number(r.end.slice(8, 10))}`
    : `${monthDay(r.start)} – ${monthDay(r.end)}`;
}

/** What one clinic did over one window. */
export interface LocationTotals {
  label: string;
  appointments: number;
  revenue: number;
  /** Scheduled open days that actually have billing behind them. */
  openDays: number;
  /** Scheduled open days with nothing at all — holiday, or a missed ingest. */
  missing: string[];
}

/** One side of the comparison, already normalized. */
export interface Window {
  range: Range;
  byLocation: Map<string, LocationTotals>;
  /** Scheduled days on which NO clinic billed: almost always an ingest gap. */
  blankDates: string[];
  /** Days at least one clinic billed on, for the group-level average. */
  openDays: number;
  appointments: number;
  revenue: number;
}

/**
 * Fold day-grain rows into per-clinic totals for `range`.
 *
 * A scheduled open day with zero billing is recorded as missing rather than as
 * a genuine zero. These clinics do not book a day and take nothing, so a blank
 * day is a holiday or an ingest that never landed; counting it as zero would
 * invent a slump that did not happen.
 *
 * Off-schedule days still contribute their appointments and revenue — money
 * taken on a Sunday is money — but they never add to a clinic's open-day count,
 * so a stray prescription pickup cannot halve the daily average.
 */
export function buildWindow(
  rows: LocationDailyRow[],
  range: Range,
  keys: string[],
): Window {
  const byKeyDate = new Map<string, LocationDailyRow>();
  const labels = new Map<string, string>();
  for (const row of rows) {
    byKeyDate.set(`${row.location_key}|${row.service_date}`, row);
    if (row.location_label) labels.set(row.location_key, row.location_label);
  }

  const dates = datesIn(range);
  const byLocation = new Map<string, LocationTotals>();
  for (const key of keys) {
    const totals: LocationTotals = {
      label: labels.get(key) ?? scheduleFor(key).label,
      appointments: 0,
      revenue: 0,
      openDays: 0,
      missing: [],
    };
    for (const date of dates) {
      const row = byKeyDate.get(`${key}|${date}`);
      const appointments = Number(row?.appointments ?? 0);
      totals.appointments += appointments;
      totals.revenue += Number(row?.revenue ?? 0);
      if (!isScheduledOpen(key, date)) continue;
      if (appointments > 0) totals.openDays += 1;
      else totals.missing.push(date);
    }
    byLocation.set(key, totals);
  }

  const blankDates: string[] = [];
  let openDays = 0;
  for (const date of dates) {
    const anyData = keys.some(
      (k) => Number(byKeyDate.get(`${k}|${date}`)?.appointments ?? 0) > 0,
    );
    if (anyData) openDays += 1;
    else if (keys.some((k) => isScheduledOpen(k, date))) blankDates.push(date);
  }

  let appointments = 0;
  let revenue = 0;
  for (const totals of byLocation.values()) {
    appointments += totals.appointments;
    revenue += totals.revenue;
  }
  return { range, byLocation, blankDates, openDays, appointments, revenue };
}

export function perDay(total: number, days: number): number {
  return days > 0 ? total / days : 0;
}

/**
 * One `• Label — value  ▲ x%` line.
 *
 * When both sides saw the same number of open days the totals are directly
 * comparable, so the delta is computed on them. When they differ — a holiday,
 * or an ingest gap — comparing totals would be meaningless, so it falls back to
 * the per-open-day average and labels the line "per day" so nobody reads the
 * percentage as a change in total volume.
 */
export function comparisonLine(
  label: string,
  cur: { value: number; days: number },
  pri: { value: number; days: number },
  fmt: (n: number) => string,
  bold = false,
): string {
  const name = bold ? `*${label}*` : label;
  if (cur.days === pri.days) {
    return `• ${name} — ${fmt(cur.value)}  ${delta(cur.value, pri.value)} _(was ${fmt(pri.value)})_`;
  }
  const d = delta(perDay(cur.value, cur.days), perDay(pri.value, pri.days));
  // "▲ 4.2% per day" and "flat per day" both read correctly; "new per day" and
  // "— per day" do not, and those two carry no rate to qualify anyway.
  const rate = d === "new" || d === "—" ? d : `${d} per day`;
  const unit = cur.days === 1 ? "day" : "days";
  return (
    `• ${name} — ${fmt(cur.value)} over ${cur.days} open ${unit}  ${rate} ` +
    `_(was ${fmt(pri.value)} over ${pri.days})_`
  );
}

/** Appointments-by-location / revenue-by-location block. */
export function metricSection(
  title: string,
  cur: Window,
  pri: Window,
  keys: string[],
  pick: (t: LocationTotals) => number,
  fmt: (n: number) => string,
): string[] {
  const lines = [
    "",
    `*${title}* · ${rangeLabel(cur.range)} vs ${rangeLabel(pri.range)}`,
  ];
  let curTotal = 0;
  let priTotal = 0;
  for (const key of keys) {
    const c = cur.byLocation.get(key);
    const p = pri.byLocation.get(key);
    if (!c || !p) continue;
    curTotal += pick(c);
    priTotal += pick(p);
    lines.push(
      comparisonLine(
        c.label,
        { value: pick(c), days: c.openDays },
        { value: pick(p), days: p.openDays },
        fmt,
      ),
    );
  }
  lines.push(
    comparisonLine(
      "Total",
      { value: curTotal, days: cur.openDays },
      { value: priTotal, days: pri.openDays },
      fmt,
      true,
    ),
  );
  return lines;
}
