"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseInvoiceCsv, labelFromFilename } from "@/lib/reporting/parse";
import {
  createInvoiceImport,
  pushInvoiceLines,
  finalizeInvoiceImport,
} from "./actions";

const CHUNK_SIZE = 800;

type Phase =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "uploading"; done: number; total: number }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export function InvoiceUploader() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [, startTransition] = useTransition();

  async function handleFile(file: File) {
    setPhase({ kind: "parsing" });
    try {
      const text = await file.text();
      const { rows, skipped, error } = parseInvoiceCsv(text);
      if (error) {
        setPhase({ kind: "error", message: error });
        return;
      }
      if (rows.length === 0) {
        setPhase({ kind: "error", message: "No invoice lines found in the file." });
        return;
      }

      const start = await createInvoiceImport(
        file.name,
        labelFromFilename(file.name),
        rows.length,
      );
      if (!start.ok) {
        setPhase({ kind: "error", message: start.error });
        return;
      }

      setPhase({ kind: "uploading", done: 0, total: rows.length });
      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const batch = rows.slice(i, i + CHUNK_SIZE);
        const res = await pushInvoiceLines(start.importId, batch);
        if (!res.ok) {
          setPhase({ kind: "error", message: res.error });
          return;
        }
        inserted += res.inserted;
        setPhase({
          kind: "uploading",
          done: Math.min(i + CHUNK_SIZE, rows.length),
          total: rows.length,
        });
      }

      const fin = await finalizeInvoiceImport(start.importId, inserted, skipped);
      if (!fin.ok) {
        setPhase({ kind: "error", message: fin.error });
        return;
      }
      setPhase({ kind: "done", message: fin.message });
      if (fileRef.current) fileRef.current.value = "";
      startTransition(() => router.refresh());
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : "Upload failed.",
      });
    }
  }

  const busy = phase.kind === "parsing" || phase.kind === "uploading";
  const pct =
    phase.kind === "uploading" && phase.total > 0
      ? Math.round((phase.done / phase.total) * 100)
      : 0;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Upload invoice lines
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Drop a monthly ezyVet <strong>Invoice Lines</strong> export (.csv).
            Lines are deduped on Invoice Line ID, so re-uploading is safe.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-emerald-700 disabled:opacity-50"
        />
      </div>

      {phase.kind === "parsing" ? (
        <p className="mt-3 text-xs text-slate-500">Parsing file…</p>
      ) : null}

      {phase.kind === "uploading" ? (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            Uploading {phase.done.toLocaleString()} / {phase.total.toLocaleString()} lines ({pct}%)
          </p>
        </div>
      ) : null}

      {phase.kind === "done" ? (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          ✓ {phase.message}
        </p>
      ) : null}

      {phase.kind === "error" ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {phase.message}
        </p>
      ) : null}
    </div>
  );
}
