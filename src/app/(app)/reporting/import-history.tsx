"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { InvoiceImportRow } from "@/lib/reporting/types";
import { fmtCurrency, fmtDate, fmtNumber } from "./charts";
import { deleteInvoiceImport, resetInvoiceData } from "./actions";

export function ImportHistory({
  imports,
  isAdmin,
}: {
  imports: InvoiceImportRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function remove(id: string) {
    if (!confirm("Remove this import and all of its invoice lines?")) return;
    setBusyId(id);
    setError(null);
    const res = await deleteInvoiceImport(id);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function reset() {
    if (
      !confirm(
        "This permanently deletes ALL invoice reporting data. Continue?",
      )
    )
      return;
    setBusyId("__reset__");
    setError(null);
    const res = await resetInvoiceData();
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  if (imports.length === 0)
    return <p className="text-xs text-slate-400">No uploads yet.</p>;

  return (
    <div>
      {error ? (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400">
              <th className="py-2 pr-3 font-semibold">Upload</th>
              <th className="py-2 pr-3 font-semibold">Period</th>
              <th className="py-2 pr-3 text-right font-semibold">New lines</th>
              <th className="py-2 pr-3 text-right font-semibold">Appts</th>
              <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
              <th className="py-2 pr-3 font-semibold">When</th>
              {isAdmin ? <th className="py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {imports.map((imp) => (
              <tr key={imp.id} className="border-b border-slate-50">
                <td className="py-2 pr-3 font-medium text-slate-700">
                  {imp.label || imp.filename || "Upload"}
                </td>
                <td className="py-2 pr-3 text-slate-500">
                  {imp.date_range_start
                    ? `${fmtDate(imp.date_range_start)} – ${fmtDate(imp.date_range_end)}`
                    : "—"}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                  {fmtNumber(imp.new_rows)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                  {fmtNumber(imp.appointment_count)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                  {fmtCurrency(imp.revenue_total)}
                </td>
                <td className="py-2 pr-3 text-slate-400">
                  {fmtDate(imp.created_at)}
                </td>
                {isAdmin ? (
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => remove(imp.id)}
                      disabled={busyId === imp.id}
                      className="rounded-md px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                    >
                      {busyId === imp.id ? "Removing…" : "Remove"}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isAdmin ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={reset}
            disabled={busyId === "__reset__"}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            {busyId === "__reset__" ? "Clearing…" : "Clear all invoice data"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
