import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPeriodReview, loadReviewSnapshot, type PayPeriodRow } from "@/lib/payroll/server";
import {
  freezeLines,
  PAY_FIELD_LABELS,
  PAY_FIELDS,
  reviewBlockers,
  reviewStale,
  reviewTotals,
  reviewWarnings,
  type PayLine,
  type ReviewedLine,
} from "@/lib/payroll/review";
import { adpExportBlockers, adpSettingsFrom, batchIdFor, CODED_FIELDS, CODED_LABELS } from "@/lib/payroll/adp-run";
import { BackToReviewButton, CompleteReviewButton, ExcludeButton, OverrideForm } from "./payroll-controls";

const n2 = (v: number) => (v ? v.toFixed(2) : "—");

function TotalsRow({ lines }: { lines: readonly ReviewedLine[] }) {
  const t = reviewTotals(lines);
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 text-sm sm:grid-cols-7">
      <div className="rounded-lg bg-slate-50 px-3 py-2">
        Employees <span className="block text-lg font-semibold tabular-nums">{t.employees}</span>
      </div>
      {PAY_FIELDS.map((f) => (
        <div key={f} className="rounded-lg bg-slate-50 px-3 py-2">
          {PAY_FIELD_LABELS[f]} <span className="block text-lg font-semibold tabular-nums">{t[f].toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

/** Steps 2 and 3 for a locked / reviewed / exported period. */
export async function ReviewAndExport({ period, viewerPersonId }: { period: PayPeriodRow; viewerPersonId: string | null }) {
  const [live, frozen, settingsRes] = await Promise.all([
    loadPeriodReview(period),
    loadReviewSnapshot(period.id),
    createAdminClient().from("app_setting").select("key, value").like("key", "payroll.adp.%"),
  ]);
  const editing = period.status === "locked";

  if (editing) {
    const blockers = reviewBlockers(live);
    const warnings = reviewWarnings(live);
    return (
      <section className="rounded-2xl border border-emerald-300 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Step 2 · Payroll Review</h2>
            <p className="mt-1 max-w-3xl text-xs text-slate-600">
              Hours come from the approved timecards; PTO is every approved paid request in the period (8 h a day).
              Adjust any line with a reason, or leave someone out of the ADP file (e.g. salaried staff RUN pays
              automatically). Every change is kept. When it&apos;s right, complete the review — the hours are frozen
              and become the ADP file.
            </p>
          </div>
          <CompleteReviewButton period={period.period_start} blockers={blockers} />
        </div>
        {blockers.length ? (
          <ul className="mt-3 space-y-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}
        {warnings.length ? (
          <ul className="mt-2 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        <TotalsRow lines={freezeLines(live)} />
        <ReviewTable lines={live} period={period.period_start} viewerPersonId={viewerPersonId} editable />
      </section>
    );
  }

  const lines = frozen ?? [];
  const settings = adpSettingsFrom(new Map((settingsRes.data ?? []).map((r) => [r.key as string, r.value as unknown])));
  const exportBlockers = adpExportBlockers(lines, settings);
  const stale = reviewStale(frozen, live);
  const exported = period.status === "exported";

  return (
    <section className="rounded-2xl border border-emerald-300 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Step 3 · Export to ADP RUN</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-600">
            The file is built only from the completed review. In RUN: <strong>Home ▸ Time Sheet Import</strong>, upload
            the file, check RUN&apos;s preview against the summary, then continue with payroll. Batch ID{" "}
            <strong>{batchIdFor(period.pay_date)}</strong> (the pay date) is the same on every download of this period, so
            RUN can spot a second import of the same hours.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action="/api/payroll/export" method="post">
            <input type="hidden" name="period" value={period.period_start} />
            <input type="hidden" name="kind" value="adp" />
            <button
              type="submit"
              disabled={exportBlockers.length > 0}
              title={exportBlockers.join(" ")}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {exported ? "Download ADP RUN file again" : "Export ADP RUN file"}
            </button>
          </form>
          <form action="/api/payroll/export" method="post">
            <input type="hidden" name="period" value={period.period_start} />
            <input type="hidden" name="kind" value="summary" />
            <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              Summary with names (CSV)
            </button>
          </form>
          {!exported ? <BackToReviewButton period={period.period_start} /> : null}
        </div>
      </div>
      {exportBlockers.length ? (
        <ul className="mt-3 space-y-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          {exportBlockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
          <li>
            <Link href="/admin/settings" className="font-medium underline">
              Admin ▸ Settings ▸ Payroll
            </Link>{" "}
            (Owner / Admin).
          </li>
        </ul>
      ) : (
        <p className="mt-2 text-xs text-slate-500">
          RUN company code <strong>{settings.companyCode}</strong>; earnings codes{" "}
          {CODED_FIELDS.map((f) => `${CODED_LABELS[f]} ${settings.codes[f] || "—"}`).join(", ")}.
        </p>
      )}
      {stale ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Something changed after the review was completed (for example a PTO request was approved for these dates).
          {exported
            ? " The file below is what was exported; an Owner/Admin can reopen the period if it must be corrected."
            : " Go back to review to pick it up, or export as reviewed."}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">
        Review completed
        {period.reviewed_at
          ? ` ${new Date(period.reviewed_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" })}`
          : ""}{" "}
        · {lines.length} employee{lines.length === 1 ? "" : "s"} in the file.
      </p>
      <TotalsRow lines={lines} />
      <ReviewTable lines={lines} period={period.period_start} viewerPersonId={viewerPersonId} />
    </section>
  );
}

function ReviewTable({
  lines,
  period,
  viewerPersonId,
  editable = false,
}: {
  lines: readonly (PayLine | ReviewedLine)[];
  period: string;
  viewerPersonId: string | null;
  editable?: boolean;
}) {
  if (!lines.length) return <p className="mt-4 text-sm text-slate-500">Nobody has hours or PTO in this period.</p>;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-100 text-xs text-slate-400">
          <tr>
            <th className="py-2 pr-3 font-medium">Employee</th>
            {PAY_FIELDS.map((f) => (
              <th key={f} className="px-2 py-2 text-right font-medium">
                {PAY_FIELD_LABELS[f]}
              </th>
            ))}
            {editable ? <th className="py-2 pl-3 text-right font-medium">Review</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l) => {
            const full = "calculated" in l ? l : null;
            const own = viewerPersonId === l.person_id;
            return (
              <tr key={l.person_id} className={`align-top ${full?.excluded ? "opacity-50" : ""}`}>
                <td className="py-2 pr-3">
                  <Link href={`/hr/${l.person_id}`} className="font-medium text-slate-800 hover:underline">
                    {l.name}
                  </Link>
                  <span className="block text-xs text-slate-400">
                    RUN ID {l.adp_employee_id ?? <span className="text-red-700">missing</span>} ·{" "}
                    {l.flsa === "exempt" ? "Exempt" : l.flsa === "non_exempt" ? "Non-exempt" : "FLSA unknown"}
                    {full?.excluded ? " · left out of the ADP file" : ""}
                  </span>
                  {full?.reasons.length ? <span className="block text-xs text-violet-700">{full.reasons.join(" · ")}</span> : null}
                </td>
                {PAY_FIELDS.map((f) => {
                  const changed = full?.overridden.includes(f);
                  return (
                    <td key={f} className={`px-2 py-2 text-right tabular-nums ${changed ? "font-semibold text-violet-800" : ""}`}>
                      {n2(l.hours[f])}
                      {changed ? <span className="block text-[11px] font-normal text-slate-400">was {n2(full!.calculated[f])}</span> : null}
                    </td>
                  );
                })}
                {editable ? (
                  <td className="py-2 pl-3 text-right">
                    {own ? (
                      <span className="text-xs text-slate-400">Your own — another approver reviews it</span>
                    ) : (
                      <span className="inline-flex flex-col items-end gap-1">
                        <OverrideForm period={period} personId={l.person_id} />
                        <ExcludeButton period={period} personId={l.person_id} excluded={!!full?.excluded} />
                      </span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
