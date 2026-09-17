import "server-only";

// ---------------------------------------------------------------------------
// Weekly Ops reporting digest for Slack.
//
// Reads the same `report_*` materialized views the Reporting page renders, plus
// the appointment-review / cancellation RPCs for the completed week, and
// flattens them into a short Slack mrkdwn message that ends with a deep link
// back to the Ops site. The digest is deliberately a teaser: headline numbers
// only, with the detail left on /reporting.
//
// Everything runs through the service-role client because migration 0164
// revoked the report_* views from `authenticated`. Callers MUST do their own
// authorization (CRON_SECRET for the cron route, module permissions for the
// manual button) before calling this.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { todayLA } from "@/lib/sheets/common";
import type {
  ReportOverview,
  MonthlyRow,
  LocationRow,
  ClientSummary,
  ClientsByMonthRow,
  AppointmentReviewRow,
  CancelledApptTypeRow,
} from "./types";

const DAY_MS = 86_400_000;

export interface ReportingDigest {
  /** Slack mrkdwn body. */
  text: string;
  /** Monday of the reported week, YYYY-MM-DD. */
  weekStart: string;
  /** Sunday of the reported week, YYYY-MM-DD. */
  weekEnd: string;
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

/**
 * The most recent complete Monday–Sunday week, relative to today in the
 * clinics' timezone. Run on a Monday this is "last week".
 */
function lastCompleteWeek(): { start: string; end: string } {
  const today = Date.parse(`${todayLA()}T00:00:00Z`);
  const dow = new Date(today).getUTCDay(); // 0 = Sunday
  const end = today - (dow === 0 ? 7 : dow) * DAY_MS;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start: iso(end - 6 * DAY_MS), end: iso(end) };
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

/** Signed percentage change, or null when there is no comparable baseline. */
function pctChange(current: number, prior: number): string | null {
  if (!prior) return null;
  const pct = ((current - prior) / prior) * 100;
  const arrow = pct >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(pct).toFixed(1)}%`;
}

function fmtMonthLabel(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtDayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Build the weekly digest. Sections with no data are omitted rather than
 * printed as zeroes, so a partially-loaded warehouse still produces a sane
 * message.
 */
export async function buildReportingDigest(): Promise<ReportingDigest> {
  const supabase = createAdminClient();
  const { start: weekStart, end: weekEnd } = lastCompleteWeek();

  const yearsRes = await supabase.from("report_years").select("year");
  const years = ((yearsRes.data ?? []) as { year: number }[])
    .map((r) => r.year)
    .sort((a, b) => b - a);
  const year = years[0] ?? new Date().getFullYear();

  const [
    overviewRes,
    monthlyRes,
    locationRes,
    clientSummaryRes,
    clientsByMonthRes,
    reviewRes,
    cancelledRes,
  ] = await Promise.all([
    supabase.from("report_overview").select("*").eq("year", year).maybeSingle(),
    supabase.from("report_monthly").select("*").eq("year", year),
    supabase.from("report_by_location").select("*").eq("year", year),
    supabase.from("report_client_summary").select("*").maybeSingle(),
    supabase.from("report_clients_by_month").select("*"),
    supabase.rpc("appointment_review", { p_start: weekStart, p_end: weekEnd }),
    supabase.rpc("cancelled_appointments_by_type", {
      p_start: weekStart,
      p_end: weekEnd,
    }),
  ]);

  const overview = (overviewRes.data as ReportOverview | null) ?? null;
  const monthly = ((monthlyRes.data ?? []) as MonthlyRow[])
    .slice()
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const locations = (locationRes.data ?? []) as LocationRow[];
  const clientSummary = (clientSummaryRes.data as ClientSummary | null) ?? null;
  const clientsByMonth = (clientsByMonthRes.data ?? []) as ClientsByMonthRow[];
  const review = (reviewRes.data ?? []) as AppointmentReviewRow[];
  const cancelled = (cancelledRes.data ?? []) as CancelledApptTypeRow[];

  const lines: string[] = [
    `*Weekly Ops Report* · ${fmtDayLabel(weekStart)} – ${fmtDayLabel(weekEnd)}`,
  ];

  // --- Last week: booked vs rendered -------------------------------------
  // rendered_count is null for days that have not been re-scanned yet; those
  // stay in "pending" instead of inflating the not-rendered gap.
  if (review.length > 0) {
    let booked = 0;
    let rendered = 0;
    let pending = 0;
    for (const row of review) {
      booked += Number(row.expected_count ?? 0);
      if (row.rendered_count == null) pending += Number(row.expected_count ?? 0);
      else rendered += Number(row.rendered_count);
    }
    const notRendered = Math.max(0, booked - pending - rendered);
    const scanned = booked - pending;
    const missRate = scanned > 0 ? ((notRendered / scanned) * 100).toFixed(1) : null;

    const parts = [
      `Booked ${fmtNum(booked)}`,
      `rendered ${fmtNum(rendered)}`,
      `not rendered ${fmtNum(notRendered)}${missRate ? ` (${missRate}%)` : ""}`,
    ];
    if (pending > 0) parts.push(`${fmtNum(pending)} not yet scanned`);
    lines.push("", "*Last week's appointments*", `• ${parts.join(" · ")}`);

    if (cancelled.length > 0) {
      const total = cancelled.reduce((s, r) => s + Number(r.cancel_count ?? 0), 0);
      const byType = new Map<string, number>();
      for (const r of cancelled) {
        const key = r.appt_type || "Unspecified";
        byType.set(key, (byType.get(key) ?? 0) + Number(r.cancel_count ?? 0));
      }
      const top = [...byType.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type, n]) => `${type} (${fmtNum(n)})`)
        .join(", ");
      lines.push(`• Cancellations ${fmtNum(total)} — top: ${top}`);
    }
  }

  // --- Latest complete month of revenue ----------------------------------
  const currentMonthPrefix = todayLA().slice(0, 7);
  const completeMonths = monthly.filter(
    (m) => String(m.month).slice(0, 7) < currentMonthPrefix,
  );
  const latest = completeMonths.at(-1) ?? monthly.at(-1) ?? null;
  const prior = latest
    ? (monthly[monthly.findIndex((m) => m.month === latest.month) - 1] ?? null)
    : null;

  if (latest) {
    const appts = Number(latest.appointments ?? 0);
    const revenue = Number(latest.revenue ?? 0);
    const avg = appts > 0 ? revenue / appts : 0;
    lines.push(
      "",
      `*${fmtMonthLabel(String(latest.month))} revenue*`,
      `• ${fmtMoney(revenue)} across ${fmtNum(appts)} appointments · avg ${fmtMoney(avg)}`,
    );
    if (prior) {
      const revDelta = pctChange(revenue, Number(prior.revenue ?? 0));
      const apptDelta = pctChange(appts, Number(prior.appointments ?? 0));
      const deltas = [
        revDelta ? `revenue ${revDelta}` : null,
        apptDelta ? `appointments ${apptDelta}` : null,
      ].filter(Boolean);
      if (deltas.length > 0) {
        lines.push(
          `• vs ${fmtMonthLabel(String(prior.month))}: ${deltas.join(" · ")}`,
        );
      }
    }
  }

  // --- Year-to-date by location ------------------------------------------
  if (locations.length > 0) {
    lines.push("", `*By location (${year} to date)*`);
    for (const loc of [...locations].sort(
      (a, b) => Number(b.revenue ?? 0) - Number(a.revenue ?? 0),
    )) {
      lines.push(
        `• ${loc.location_label} — ${fmtMoney(loc.revenue)} · ${fmtNum(
          loc.appointments,
        )} appts · avg ${fmtMoney(loc.avg_appointment_value)}`,
      );
    }
    if (overview) {
      lines.push(
        `• *Total* — ${fmtMoney(overview.total_revenue)} · ${fmtNum(
          overview.total_appointments,
        )} appts · ${fmtNum(overview.unique_clients)} clients`,
      );
    }
  }

  // --- Clients ------------------------------------------------------------
  if (clientSummary) {
    const newestClientMonth = [...clientsByMonth].sort((a, b) =>
      String(a.month).localeCompare(String(b.month)),
    ).at(-1);
    const bits = [
      `${fmtNum(clientSummary.active_contacts)} active clients`,
      `${fmtNum(clientSummary.customers)} customers`,
    ];
    if (newestClientMonth) {
      bits.push(
        `${fmtNum(newestClientMonth.new_clients)} new in ${fmtMonthLabel(
          String(newestClientMonth.month),
        )}`,
      );
    }
    lines.push("", "*Clients*", `• ${bits.join(" · ")}`);
  }

  lines.push(
    "",
    `<${appBaseUrl()}/reporting|Open Reporting on the Ops site →> for the full breakdown by doctor, product, species and location.`,
  );

  return { text: lines.join("\n"), weekStart, weekEnd };
}
