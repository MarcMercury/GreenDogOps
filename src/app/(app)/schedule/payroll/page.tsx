import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { canApproveTime, isAdminRole } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { isIsoDate, shortDateLabel, todayInWorkTz } from "@/lib/worklist/dates";
import { payPeriodFor, recentPayPeriods } from "@/lib/timeclock/pay-period";
import { hours, MEAL_ISSUE_LABELS } from "@/lib/payroll/ca-rules";
import { lockBlockers } from "@/lib/payroll/period";
import { ensurePayPeriod, loadPeriodTimecards } from "@/lib/payroll/server";
import { PageHeader } from "../../_components/ui";
import { ApproveButton, LockButton, ReopenButton } from "./payroll-controls";
import { ReviewAndExport } from "./review-section";

export const dynamic = "force-dynamic";

const h = (m: number) => hours(m).toFixed(2);
const STATUS_STYLE = {
  open: "bg-amber-50 text-amber-800",
  locked: "bg-sky-50 text-sky-800",
  reviewed: "bg-violet-50 text-violet-800",
  exported: "bg-emerald-50 text-emerald-800",
} as const;

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const current = await getCurrentUser({ allowPreview: true });
  if (!current || !canApproveTime(current.appUser)) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Payroll is for timecard approvers: Owner, Admin, Executive and HR / Manager.
      </div>
    );
  }
  const { period: periodParam } = await searchParams;
  const today = todayInWorkTz();
  const periods = recentPayPeriods(today, 6);
  const chosen =
    periodParam && isIsoDate(periodParam) && payPeriodFor(periodParam).start === periodParam
      ? payPeriodFor(periodParam)
      : periods[0];
  const period = await ensurePayPeriod(chosen);
  const [rows, exports] = await Promise.all([
    loadPeriodTimecards(period),
    createAdminClient()
      .from("payroll_export")
      .select("id, format, file_name, file_sha256, employee_count, created_at")
      .eq("pay_period_id", period.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const blockers = lockBlockers(rows, period.period_end, today);
  const approved = rows.filter((r) => r.approval && !r.approval.stale).length;
  const missingRunId = rows.filter((r) => !r.adp_employee_id).length;
  const unknownFlsa = rows.filter((r) => r.flsa === "unknown").length;
  const open = period.status === "open";
  const total = (k: "regular" | "overtime" | "doubleTime" | "worked") => rows.reduce((n, r) => n + r.result.totals[k], 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Payroll"
        description="1. Approve every timecard and lock the pay period. 2. Payroll Review: check each employee's hours and PTO, adjust with a reason. 3. Export the ADP RUN file and import it in RUN (Home ▸ Time Sheet Import). Hours follow California rules."
      />

      <p className="text-xs text-slate-500">
        How hours, premiums and PTO are calculated:{" "}
        <Link href="/hr/pto-rules" className="font-medium text-emerald-700 underline">
          PTO &amp; Timekeeping Rules
        </Link>
      </p>
      <nav className="flex flex-wrap gap-2" aria-label="Pay period">
        {periods.map((p) => (
          <Link
            key={p.start}
            href={`/schedule/payroll?period=${p.start}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              p.start === period.period_start ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            {shortDateLabel(p.start)} – {shortDateLabel(p.end)}
          </Link>
        ))}
      </nav>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {shortDateLabel(period.period_start)} – {shortDateLabel(period.period_end)} · paid {shortDateLabel(period.pay_date)}
            </h2>
            <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLE[period.status]}`}>
              {period.status}
            </span>
            <span className="ml-2 text-xs text-slate-500">
              {approved} of {rows.length} timecards approved
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {open ? <LockButton period={period.period_start} blockers={blockers} /> : null}
            {!open && isAdminRole(current.appUser.role) ? <ReopenButton period={period.period_start} /> : null}
          </div>
        </div>
        {open && blockers.length ? <p className="mt-2 text-xs text-slate-500">To lock: {blockers.join(" ")}</p> : null}
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 px-3 py-2">Regular <span className="block text-lg font-semibold tabular-nums">{h(total("regular"))}</span></div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">Overtime <span className="block text-lg font-semibold tabular-nums">{h(total("overtime"))}</span></div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">Double time <span className="block text-lg font-semibold tabular-nums">{h(total("doubleTime"))}</span></div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">Worked <span className="block text-lg font-semibold tabular-nums">{h(total("worked"))}</span></div>
        </div>
        <ol className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          {[
            { n: 1, label: "Approve & lock", done: !open, active: open },
            { n: 2, label: "Payroll review", done: period.status === "reviewed" || period.status === "exported", active: period.status === "locked" },
            { n: 3, label: "Export to ADP RUN", done: period.status === "exported", active: period.status === "reviewed" },
          ].map((st) => (
            <li
              key={st.n}
              className={`rounded-lg border px-3 py-2 ${st.active ? "border-emerald-500 bg-emerald-50 text-emerald-900" : st.done ? "border-slate-200 bg-slate-50 text-slate-500" : "border-dashed border-slate-200 text-slate-400"}`}
            >
              <span className="font-semibold">{st.done ? "✓" : st.n}.</span> {st.label}
            </li>
          ))}
        </ol>
        {missingRunId || unknownFlsa ? (
          <p className="mt-2 text-xs text-slate-500">
            {missingRunId ? `${missingRunId} employee(s) here have no ADP RUN Employee ID yet (add it on the HR profile before export).` : ""}
            {unknownFlsa ? ` ${unknownFlsa} have no FLSA status (treated as non-exempt).` : ""}
          </p>
        ) : null}
      </section>

      {!open ? <ReviewAndExport period={period} viewerPersonId={current.appUser.person_id} /> : null}

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!open ? <h2 className="px-5 pt-4 text-sm font-semibold text-slate-900">Approved timecards</h2> : null}
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No time-clock punches in this pay period.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-2 py-2 text-right font-medium">Regular</th>
                <th className="px-2 py-2 text-right font-medium">OT 1.5x</th>
                <th className="px-2 py-2 text-right font-medium">DT 2x</th>
                <th className="px-2 py-2 text-right font-medium">Meal prem.</th>
                <th className="px-2 py-2 font-medium">Flags</th>
                <th className="px-4 py-2 text-right font-medium">Approval</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const mealDays = r.result.days.filter((d) => d.mealPremium);
                return (
                  <tr key={r.person_id} className="align-top">
                    <td className="px-4 py-2">
                      <span className="font-medium text-slate-800">{r.name}</span>
                      <span className="block text-xs text-slate-400">
                        {r.flsa === "exempt" ? "Exempt" : r.flsa === "non_exempt" ? "Non-exempt" : "FLSA unknown"} · RUN ID{" "}
                        {r.adp_employee_id ?? <span className="text-amber-700">missing</span>}
                      </span>
                      <details className="mt-1 text-xs text-slate-500">
                        <summary className="cursor-pointer">{r.result.days.length} day(s)</summary>
                        <ul className="mt-1 space-y-0.5">
                          {r.result.days.map((d) => (
                            <li key={d.work_date}>
                              {shortDateLabel(d.work_date)}: {h(d.worked)} h (reg {h(d.regular)}, OT {h(d.overtime)}, DT {h(d.doubleTime)})
                              {d.seventhDay ? " · 7th day" : ""}
                              {d.mealPremium && d.mealIssue ? ` · meal: ${MEAL_ISSUE_LABELS[d.mealIssue]}` : ""}
                              {d.mealWaived ? " · meal waived" : ""}
                              {d.incomplete ? " · missing punch" : ""}
                              {d.pendingApproval ? " · off-site pending" : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{h(r.result.totals.regular)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{h(r.result.totals.overtime)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{h(r.result.totals.doubleTime)}</td>
                    <td className="px-2 py-2 text-right tabular-nums" title={mealDays.map((d) => d.work_date).join(", ")}>
                      {r.result.totals.mealPremiums}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {r.blockers.length ? (
                        <span className="text-red-700">
                          {r.blockers.join("; ")} —{" "}
                          <Link href="/schedule/time-clock" className="underline">
                            fix in Time Clock
                          </Link>
                        </span>
                      ) : r.approval?.stale ? (
                        <span className="text-amber-700">Changed since approval</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-slate-500">
                      {r.approval && !r.approval.stale ? (
                        <span className="block">
                          ✓ {r.approval.approved_by_name ?? "Approved"}
                        </span>
                      ) : null}
                      {open ? (
                        <ApproveButton
                          period={period.period_start}
                          personId={r.person_id}
                          approved={!!r.approval && !r.approval.stale}
                          disabled={r.blockers.length > 0 || current.appUser.person_id === r.person_id}
                          title={current.appUser.person_id === r.person_id ? "You can't approve your own timecard" : r.blockers.join("; ")}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {(exports.data ?? []).length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Export history</h2>
          <ul className="mt-2 space-y-1">
            {((exports.data ?? []) as { id: string; format: string; file_name: string; file_sha256: string; employee_count: number; created_at: string }[]).map((e) => (
              <li key={e.id}>
                {new Date(e.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} · {e.file_name} · {e.employee_count} employees ·{" "}
                {e.format} · SHA-256 {e.file_sha256.slice(0, 12)}…
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
