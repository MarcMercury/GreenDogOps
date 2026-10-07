import "server-only";

// ---------------------------------------------------------------------------
// Weekly Ops reporting digest for Slack.
//
// Every section compares the last complete BUSINESS week (Monday–Saturday) to
// the business week before it:
//   1. Appointments per clinic.
//   2. Revenue per clinic.
//   3. Appointment TYPE breakdown per clinic.
// Then a deep link back to /reporting. Cancellations are deliberately not
// reported here.
//
// Why business weeks and not calendar windows: the clinics are closed Sundays,
// and Sherman Oaks only runs Mon/Wed/Fri, so any window that counts raw
// calendar days compares a different number of trading days on each side. The
// earlier month-to-date version of this digest did exactly that and reported a
// ~73% "collapse" in volume that was really Thu–Sun measured against Tue–Fri.
//
// Normalization rules, all enforced in this module:
//   * Sunday is never in the window, for either side of the comparison.
//   * A clinic's denominator is ITS OWN open days (CLINIC_SCHEDULE), so
//     Sherman Oaks is never divided by six.
//   * A scheduled open day with no billing at all is treated as "no data"
//     (holiday or a missed ingest) rather than a genuine zero: it is dropped
//     from the denominator instead of dragging the average down.
//   * When the two sides end up with different open-day counts, the headline
//     delta switches to a per-open-day average so it stays apples-to-apples,
//     and the line says so.
// When NO clinic billed on a scheduled day, that is almost certainly a gap in
// the ezyVet invoice ingest rather than a company-wide closure, so the message
// calls it out — the totals understate the week until it backfills.
//
// Appointment and revenue numbers come from report_location_daily() (migration
// 0222), the day-grain wrapper over the ezyvet_appointment matview; the day
// grain is what makes open-day counting and gap detection possible. Type
// numbers come from appointment_review_by_type() over the Agenda snapshots.
//
// Everything runs through the service-role client because migration 0164
// revoked the report_* views from `authenticated`. Callers MUST do their own
// authorization (CRON_SECRET for the cron route, module permissions for the
// manual button) before calling this.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { todayLA } from "@/lib/sheets/common";
import type { LocationDailyRow, AppointmentReviewTypeRow } from "./types";
import {
  CLINIC_SCHEDULE,
  addDays,
  buildWindow,
  delta,
  fmtMoney,
  fmtNum,
  lastCompleteBusinessWeek,
  metricSection,
  monthDay,
  rangeLabel,
} from "./digest-window";

/** Appointment types listed per clinic before the rest are rolled up. */
const TYPES_PER_LOCATION = 5;

export interface ReportingDigest {
  /** Slack mrkdwn body. */
  text: string;
  /** Monday of the reported business week, YYYY-MM-DD. */
  weekStart: string;
  /** Saturday of the reported business week, YYYY-MM-DD. Sunday is excluded. */
  weekEnd: string;
  /** Last day included in the numbers, YYYY-MM-DD. Same as `weekEnd`. */
  asOf: string;
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
 * Build the weekly digest. The three scheduled clinics are always listed, even
 * at zero, so one vanishing from the warehouse is visible rather than silent;
 * the appointment-type section is dropped entirely when the Agenda snapshots
 * have nothing, so a partially-loaded warehouse still produces a sane message.
 */
export async function buildReportingDigest(): Promise<ReportingDigest> {
  const supabase = createAdminClient();
  const week = lastCompleteBusinessWeek(todayLA());
  const priorWeek = { start: addDays(week.start, -7), end: addDays(week.end, -7) };

  const [dailyRes, priorDailyRes, typeRes, priorTypeRes] = await Promise.all([
    supabase.rpc("report_location_daily", { p_start: week.start, p_end: week.end }),
    supabase.rpc("report_location_daily", {
      p_start: priorWeek.start,
      p_end: priorWeek.end,
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

  const curRows = (dailyRes.data ?? []) as LocationDailyRow[];
  const priRows = (priorDailyRes.data ?? []) as LocationDailyRow[];

  // Every scheduled clinic is always reported, plus any other bucket that
  // carried business in either week (unmapped invoices land in `other`).
  const extraKeys = new Set<string>();
  for (const row of [...curRows, ...priRows]) {
    if (!(row.location_key in CLINIC_SCHEDULE)) extraKeys.add(row.location_key);
  }
  const keys = [...Object.keys(CLINIC_SCHEDULE), ...extraKeys];

  const cur = buildWindow(curRows, week, keys);
  const pri = buildWindow(priRows, priorWeek, keys);
  const ordered = keys
    .filter(
      (k) =>
        k in CLINIC_SCHEDULE ||
        cur.byLocation.get(k)!.appointments > 0 ||
        pri.byLocation.get(k)!.appointments > 0,
    )
    .sort((a, b) => cur.byLocation.get(b)!.revenue - cur.byLocation.get(a)!.revenue);

  const lines: string[] = [
    `*Weekly Ops Report* · week of ${rangeLabel(week)}`,
    `_Last complete business week (Mon–Sat) vs the week before. Sundays excluded; each clinic is measured over the days it is actually open._`,
  ];

  // A scheduled day on which no clinic billed anything is not a slow day, it
  // is a day the warehouse never received. Say so, because the totals below
  // are short by that day until the ingest backfills.
  if (cur.blankDates.length > 0) {
    const list = cur.blankDates.map(monthDay).join(", ");
    lines.push(
      "",
      `:warning: _No billing data for ${list} — left out of the per-day averages. Unless that was a holiday the ezyVet invoice ingest has a gap and the totals below understate the week._`,
    );
  }

  // --- 1 & 2. Appointments and revenue per location, week over week -------
  lines.push(
    ...metricSection(
      "Appointments by location",
      cur,
      pri,
      ordered,
      (t) => t.appointments,
      fmtNum,
    ),
  );
  lines.push(
    ...metricSection("Revenue by location", cur, pri, ordered, (t) => t.revenue, fmtMoney),
  );

  // --- 3. Appointment types per location, same two business weeks ---------
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

  return {
    text: lines.join("\n"),
    weekStart: week.start,
    weekEnd: week.end,
    asOf: week.end,
  };
}
