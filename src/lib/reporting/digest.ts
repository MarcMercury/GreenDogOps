import "server-only";

// ---------------------------------------------------------------------------
// Weekly Ops reporting digest for Slack.
//
// Three sections, in this order:
//   1. Appointments per clinic, month-to-date vs the prior month through the
//      SAME day of the month (so a partial month is never compared against a
//      full one).
//   2. Revenue per clinic, on the same month-to-date basis.
//   3. Appointment TYPE breakdown per clinic for the last complete week vs the
//      week before it.
// Then a deep link back to /reporting. Cancellations are deliberately not
// reported here.
//
// Month-to-date numbers come from report_location_period() (migration 0192),
// which wraps the day-grain ezyvet_appointment matview — report_by_location and
// report_location_monthly only offer year and month grains. Type numbers come
// from appointment_review_by_type() over the Agenda snapshots.
//
// Everything runs through the service-role client because migration 0164
// revoked the report_* views from `authenticated`. Callers MUST do their own
// authorization (CRON_SECRET for the cron route, module permissions for the
// manual button) before calling this.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { todayLA } from "@/lib/sheets/common";
import type { LocationPeriodRow, AppointmentReviewTypeRow } from "./types";

const DAY_MS = 86_400_000;
/** Appointment types listed per clinic before the rest are rolled up. */
const TYPES_PER_LOCATION = 5;

export interface ReportingDigest {
  /** Slack mrkdwn body. */
  text: string;
  /** Monday of the reported week, YYYY-MM-DD. */
  weekStart: string;
  /** Sunday of the reported week, YYYY-MM-DD. */
  weekEnd: string;
  /** Last day included in the month-to-date numbers, YYYY-MM-DD. */
  asOf: string;
}

interface Range {
  start: string;
  end: string;
}

/** Public origin for links back into the app, without a trailing slash. */
function appBaseUrl(): string {
  const raw =
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  return raw.replace(/\/+$/, "");
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The most recent complete Monday–Sunday week, relative to today in the
 * clinics' timezone. Run on a Monday this is "last week".
 */
function lastCompleteWeek(): Range {
  const today = Date.parse(`${todayLA()}T00:00:00Z`);
  const dow = new Date(today).getUTCDay(); // 0 = Sunday
  const end = new Date(today - (dow === 0 ? 7 : dow) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return { start: addDays(end, -6), end };
}

/**
 * Month-to-date through `asOf`, and the prior month through the same day of the
 * month. The day is clamped to the prior month's length, so Mar 31 compares
 * against Feb 28.
 */
function monthToDateRanges(asOf: string): { current: Range; prior: Range } {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const day = Number(asOf.slice(8, 10));
  const priorMonth = month === 1 ? 12 : month - 1;
  const priorYear = month === 1 ? year - 1 : year;
  const daysInPrior = new Date(Date.UTC(priorYear, priorMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    current: { start: `${asOf.slice(0, 8)}01`, end: asOf },
    prior: {
      start: `${priorYear}-${pad(priorMonth)}-01`,
      end: `${priorYear}-${pad(priorMonth)}-${pad(Math.min(day, daysInPrior))}`,
    },
  };
}

function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 10_000) return `$${Math.round(v / 1000)}k`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function fmtNum(n: number | null | undefined): string {
  return Math.round(Number(n ?? 0)).toLocaleString("en-US");
}

/** `▲ 4.2%`, or `new` when there is no baseline to compare against. */
function delta(current: number, prior: number): string {
  if (!prior) return current ? "new" : "—";
  const pct = ((current - prior) / prior) * 100;
  if (Math.abs(pct) < 0.05) return "flat";
  return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`;
}

function monthDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function rangeLabel(r: Range): string {
  return r.start.slice(0, 7) === r.end.slice(0, 7)
    ? `${monthDay(r.start)}–${Number(r.end.slice(8, 10))}`
    : `${monthDay(r.start)} – ${monthDay(r.end)}`;
}

/** Booked appointments per (location, type). Booked = scheduled + pending. */
function bookedByLocationType(
  rows: AppointmentReviewTypeRow[],
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const location = row.location_name || "Unassigned";
    const booked = Number(row.scheduled ?? 0) + Number(row.pending ?? 0);
    if (booked === 0) continue;
    const types = out.get(location) ?? new Map<string, number>();
    types.set(row.appt_type, (types.get(row.appt_type) ?? 0) + booked);
    out.set(location, types);
  }
  return out;
}

function sumValues(map: Map<string, number> | undefined): number {
  let sum = 0;
  for (const v of map?.values() ?? []) sum += v;
  return sum;
}

/**
 * Build the weekly digest. Sections with no data are omitted rather than
 * printed as zeroes, so a partially-loaded warehouse still produces a sane
 * message.
 */
export async function buildReportingDigest(): Promise<ReportingDigest> {
  const supabase = createAdminClient();
  const week = lastCompleteWeek();
  const priorWeek = { start: addDays(week.start, -7), end: addDays(week.end, -7) };
  // Yesterday: today's invoice lines have not been ingested yet.
  const asOf = addDays(todayLA(), -1);
  const { current: mtd, prior: priorMtd } = monthToDateRanges(asOf);

  const [mtdRes, priorMtdRes, typeRes, priorTypeRes] = await Promise.all([
    supabase.rpc("report_location_period", { p_start: mtd.start, p_end: mtd.end }),
    supabase.rpc("report_location_period", {
      p_start: priorMtd.start,
      p_end: priorMtd.end,
    }),
    supabase.rpc("appointment_review_by_type", {
      p_start: week.start,
      p_end: week.end,
    }),
    supabase.rpc("appointment_review_by_type", {
      p_start: priorWeek.start,
      p_end: priorWeek.end,
    }),
  ]);

  const currentRows = (mtdRes.data ?? []) as LocationPeriodRow[];
  const priorByKey = new Map(
    ((priorMtdRes.data ?? []) as LocationPeriodRow[]).map((r) => [r.location_key, r]),
  );
  const ordered = [...currentRows].sort(
    (a, b) => Number(b.revenue ?? 0) - Number(a.revenue ?? 0),
  );
  const mtdLabel = `${rangeLabel(mtd)} vs ${rangeLabel(priorMtd)}`;

  const lines: string[] = [
    `*Weekly Ops Report* · week of ${rangeLabel(week)}`,
    `_Runs every Monday: compares the previous week's business to the week prior._`,
  ];

  // --- 1. Appointments per location, MTD vs prior month through same day --
  if (ordered.length > 0) {
    lines.push("", `*Appointments by location* · ${mtdLabel}`);
    let curTotal = 0;
    let priTotal = 0;
    for (const row of ordered) {
      const cur = Number(row.appointments ?? 0);
      const pri = Number(priorByKey.get(row.location_key)?.appointments ?? 0);
      curTotal += cur;
      priTotal += pri;
      lines.push(
        `• ${row.location_label} — ${fmtNum(cur)}  ${delta(cur, pri)} _(was ${fmtNum(pri)})_`,
      );
    }
    lines.push(
      `• *Total* — ${fmtNum(curTotal)}  ${delta(curTotal, priTotal)} _(was ${fmtNum(priTotal)})_`,
    );
  }

  // --- 2. Revenue per location, same month-to-date basis ------------------
  if (ordered.length > 0) {
    lines.push("", `*Revenue by location* · ${mtdLabel}`);
    let curTotal = 0;
    let priTotal = 0;
    for (const row of ordered) {
      const cur = Number(row.revenue ?? 0);
      const pri = Number(priorByKey.get(row.location_key)?.revenue ?? 0);
      curTotal += cur;
      priTotal += pri;
      lines.push(
        `• ${row.location_label} — ${fmtMoney(cur)}  ${delta(cur, pri)} _(was ${fmtMoney(pri)})_`,
      );
    }
    lines.push(
      `• *Total* — ${fmtMoney(curTotal)}  ${delta(curTotal, priTotal)} _(was ${fmtMoney(priTotal)})_`,
    );
  }

  // --- 3. Appointment types per location, last week vs the week before ----
  const currentTypes = bookedByLocationType(
    (typeRes.data ?? []) as AppointmentReviewTypeRow[],
  );
  const priorTypes = bookedByLocationType(
    (priorTypeRes.data ?? []) as AppointmentReviewTypeRow[],
  );
  if (currentTypes.size > 0) {
    lines.push(
      "",
      `*Appointment types by location* · ${rangeLabel(week)} vs ${rangeLabel(priorWeek)}`,
    );
    const locations = [...currentTypes.entries()].sort(
      (a, b) => sumValues(b[1]) - sumValues(a[1]),
    );
    for (const [location, types] of locations) {
      const priorForLocation = priorTypes.get(location);
      const curTotal = sumValues(types);
      const priTotal = sumValues(priorForLocation);
      lines.push(
        `*${location}* — ${fmtNum(curTotal)} booked  ${delta(curTotal, priTotal)} _(was ${fmtNum(priTotal)})_`,
      );
      const ranked = [...types.entries()].sort((a, b) => b[1] - a[1]);
      for (const [type, count] of ranked.slice(0, TYPES_PER_LOCATION)) {
        const pri = priorForLocation?.get(type) ?? 0;
        lines.push(
          `  • ${type} — ${fmtNum(count)}  ${delta(count, pri)} _(was ${fmtNum(pri)})_`,
        );
      }
      const rest = ranked.slice(TYPES_PER_LOCATION);
      if (rest.length > 0) {
        const restCount = rest.reduce((s, [, n]) => s + n, 0);
        lines.push(`  • _${rest.length} other types — ${fmtNum(restCount)}_`);
      }
    }
  }

  lines.push(
    "",
    `<${appBaseUrl()}/reporting|Open Reporting on the Ops site →> for the full breakdown by doctor, product, species and location.`,
  );

  return { text: lines.join("\n"), weekStart: week.start, weekEnd: week.end, asOf };
}
