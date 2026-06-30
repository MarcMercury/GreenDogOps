"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ContactImportRow } from "@/lib/reporting/types";
import { fmtDate, fmtNumber } from "../reporting/charts";
import { resetContactData } from "./actions";

export function ContactImportHistory({
  imports,
  isAdmin,
}: {
  imports: ContactImportRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function reset() {
    if (!confirm("This permanently deletes ALL ezyVet contact data. Continue?"))
      return;
    setBusy(true);
    setError(null);
    const res = await resetContactData();
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div>
      {error ? (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
      {imports.length === 0 ? (
        <p className="text-xs text-slate-400">No uploads yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400">
                <th className="py-2 pr-3 font-semibold">File</th>
                <th className="py-2 pr-3 text-right font-semibold">Rows</th>
                <th className="py-2 pr-3 text-right font-semibold">New</th>
                <th className="py-2 pr-3 text-right font-semibold">Updated</th>
                <th className="py-2 pr-3 text-right font-semibold">Unchanged</th>
                <th className="py-2 font-semibold">When</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((imp) => (
                <tr key={imp.id} className="border-b border-slate-50">
                  <td className="py-2 pr-3 font-medium text-slate-700">
                    {imp.filename || "Upload"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                    {fmtNumber(imp.total_rows)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-emerald-600">
                    {fmtNumber(imp.new_contacts)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-indigo-600">
                    {fmtNumber(imp.updated_contacts)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-400">
                    {fmtNumber(imp.unchanged_contacts)}
                  </td>
                  <td className="py-2 text-slate-400">{fmtDate(imp.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isAdmin ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            {busy ? "Clearing…" : "Clear all contact data"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
