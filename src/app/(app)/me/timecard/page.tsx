import Link from "next/link";
import { addDays, shortDateLabel, todayInWorkTz } from "@/lib/worklist/dates";
import { getMyCorrections, getPunches, TIME_CLOCK_TZ } from "@/lib/timeclock/server";
import { recentPayPeriods } from "@/lib/timeclock/pay-period";
import {
  buildSessions,
  dayTotals,
  decimalHours,
  formatDuration,
  type SessionStatus,
} from "@/lib/timeclock/timecard";
import { formatClockTime } from "@/lib/timeclock/local-time";
import { CORRECTION_WINDOW_DAYS, PUNCH_LABELS } from "@/lib/timeclock/state";
import { loadSelf, selfProblemMessage } from "../self";
import { CancelCorrectionButton, CorrectionForm } from "./correction-form";

export const dynamic = "force-dynamic";

const PERIODS_SHOWN = 6;

const STATUS_NOTE: Partial<Record<SessionStatus, string>> = {
  open: "In progress",
  missing_clock_out: "No clock-out — request a correction",
  missing_clock_in: "No clock-in — request a correction",
};

const REQUEST_STATUS: Record<string, string> = {
  pending: "Waiting for review",
  approved: "Approved",
  denied: "Denied",
  cancelled: "Cancelled",
};

const KIND_LABEL: Record<string, string> = {
  missing_punch: "Forgot to punch",
  wrong_time: "Wrong time",
  other: "Other",
};

export default async function MyTimecardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const self = await loadSelf();
  if (!self.ok) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        {selfProblemMessage(self.reason)}
      </section>
    );
  }
  const { period: periodParam } = await searchParams;
  const today = todayInWorkTz();
  const periods = recentPayPeriods(today, PERIODS_SHOWN);
  const period = periods.find((p) => p.start === periodParam) ?? periods[0];

  const [punches, corrections] = await Promise.all([
    getPunches(self.person.id, period.start, period.end),
    getMyCorrections(self.person.id),
  ]);
  const days = dayTotals(buildSessions(punches));
  const totalMs = days.reduce((t, d) => t + d.worked_ms, 0);
  const needsFix = days.filter((d) => d.needs_correction).length;

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label="Pay period">
        {periods.map((p, i) => (
          <Link
            key={p.start}
            href={i === 0 ? "/me/timecard" : `/me/timecard?period=${p.start}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              p.start === period.start
                ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            {shortDateLabel(p.start)} – {shortDateLabel(p.end)}
          </Link>
        ))}
      </nav>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Pay period {shortDateLabel(period.start)} – {shortDateLabel(period.end)}
          </h2>
          <p className="text-sm text-slate-600">
            <span className="text-lg font-semibold text-slate-900 tabular-nums">{decimalHours(totalMs)}</span> hours
            <span className="ml-2 text-xs text-slate-400">paid {shortDateLabel(period.payDate)}</span>
          </p>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Hours here are what you punched. Your approved timecard (and any overtime or premiums) is finalised by payroll.
        </p>
        {needsFix > 0 ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {needsFix === 1 ? "1 day needs" : `${needsFix} days need`} a correction before it can count.
          </p>
        ) : null}

        {days.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No punches in this pay period.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {days.map((d) => (
              <li key={d.work_date} className="py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-slate-800">{shortDateLabel(d.work_date)}</span>
                  <span className="text-sm tabular-nums text-slate-700">
                    {d.worked_ms > 0 ? `${formatDuration(d.worked_ms)} (${decimalHours(d.worked_ms)})` : "—"}
                  </span>
                </div>
                {d.sessions.map((s, i) => (
                  <div key={i} className="mt-1 text-xs text-slate-500">
                    {s.clock_in ? formatClockTime(s.clock_in, TIME_CLOCK_TZ) : "?"} –{" "}
                    {s.clock_out ? formatClockTime(s.clock_out, TIME_CLOCK_TZ) : "?"}
                    {s.lunch_ms > 0 ? ` · lunch ${formatDuration(s.lunch_ms)}` : ""}
                    {s.rest_breaks_ok === false ? " · rest breaks missed" : ""}
                    {s.punches.some((x) => x.approval === "pending") ? (
                      <span className="ml-2 text-amber-700">Off-site — awaiting approval</span>
                    ) : null}
                    {s.punches.some((x) => x.origin === "adjustment") ? (
                      <span className="ml-2 text-slate-400">Includes a manager correction</span>
                    ) : null}
                    {STATUS_NOTE[s.status] ? (
                      <span className={s.status === "open" ? "ml-2 text-emerald-700" : "ml-2 text-amber-700"}>
                        {STATUS_NOTE[s.status]}
                      </span>
                    ) : null}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Request a correction</h2>
        <p className="mb-3 mt-1 text-xs text-slate-500">
          Punches are never edited. Your request goes to a manager; if approved, the correction is recorded alongside
          the original punch.
        </p>
        <CorrectionForm minDate={addDays(today, -CORRECTION_WINDOW_DAYS)} maxDate={today} />
      </section>

      {corrections.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">My correction requests</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {corrections.map((c) => (
              <li key={c.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-800">
                    {shortDateLabel(c.work_date)} · {KIND_LABEL[c.kind]}
                    {c.punch_type ? ` · ${PUNCH_LABELS[c.punch_type]}` : ""}
                    {c.requested_time ? ` at ${formatClockTime(c.requested_time, TIME_CLOCK_TZ)}` : ""}
                  </span>
                  <span className="text-xs text-slate-500">
                    {REQUEST_STATUS[c.status]}
                    {c.status === "pending" ? (
                      <>
                        {" · "}
                        <CancelCorrectionButton id={c.id} />
                      </>
                    ) : null}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{c.reason}</p>
                {c.review_note ? <p className="text-xs text-slate-600">Manager: {c.review_note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
