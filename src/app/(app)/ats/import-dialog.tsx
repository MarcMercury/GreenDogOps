"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  parseCandidateList,
  parseResumeFile,
  createCandidates,
} from "./actions";
import { emptyCandidate, type ParsedCandidate } from "@/lib/ats/import-types";

type Mode = "list" | "resume";

const LIST_ACCEPT = ".csv,.xls,.xlsx,.pdf,image/*";
const RESUME_ACCEPT = ".pdf,.doc,.docx,.txt,.md,.rtf,image/*";

const FIELDS: { key: keyof ParsedCandidate; label: string; placeholder: string }[] = [
  { key: "full_name", label: "Name", placeholder: "Full name" },
  { key: "email", label: "Email", placeholder: "email@…" },
  { key: "phone_mobile", label: "Phone", placeholder: "Phone" },
  { key: "target_title", label: "Position", placeholder: "Role" },
  { key: "source", label: "Source", placeholder: "Source" },
];

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("list");
  const [staged, setStaged] = useState<ParsedCandidate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [parsing, startParse] = useTransition();
  const [saving, startSave] = useTransition();

  if (!open) return null;

  function reset() {
    setStaged([]);
    setWarnings([]);
    setError(null);
    setResult(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function pickFile() {
    fileRef.current?.click();
  }

  function onFile(file: File) {
    setError(null);
    setResult(null);
    const form = new FormData();
    form.set("file", file);
    startParse(async () => {
      if (mode === "list") {
        const res = await parseCandidateList(form);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setStaged((prev) => [...prev, ...res.candidates]);
        setWarnings(res.warnings);
      } else {
        const res = await parseResumeFile(form);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setStaged((prev) => [...prev, res.candidate]);
        setWarnings([]);
      }
    });
  }

  function updateRow(index: number, key: keyof ParsedCandidate, value: string) {
    setStaged((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [key]: value === "" ? null : value } : c)),
    );
  }

  function removeRow(index: number) {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  }

  function addBlankRow() {
    setStaged((prev) => [...prev, emptyCandidate()]);
  }

  function handleCreate() {
    setError(null);
    startSave(async () => {
      const res = await createCandidates(staged);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const parts = [`Created ${res.created} candidate${res.created === 1 ? "" : "s"}.`];
      if (res.failed > 0) parts.push(`${res.failed} failed.`);
      setResult(parts.join(" "));
      setStaged([]);
      setWarnings([]);
      router.refresh();
    });
  }

  const busy = parsing || saving;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 p-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Import candidates</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Import a list of applicants, or extract one from a resume. Review before creating.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 transition hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Mode toggle + upload */}
        <div className="border-b border-slate-200 p-4">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm">
            <button
              onClick={() => setMode("list")}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                mode === "list" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              📋 Import list
            </button>
            <button
              onClick={() => setMode("resume")}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                mode === "resume" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              📄 Upload resume
            </button>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            {mode === "list"
              ? "CSV or Excel with columns like Name, Email, Phone, Position. PDF/image rosters are read with AI."
              : "PDF, Word, image, or text. The system extracts contact details and a short summary."}
          </p>

          <input
            ref={fileRef}
            type="file"
            accept={mode === "list" ? LIST_ACCEPT : RESUME_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={pickFile}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {parsing ? "Reading…" : mode === "list" ? "⬆ Choose file" : "⬆ Choose resume"}
            </button>
            {staged.length > 0 ? (
              <button
                onClick={addBlankRow}
                disabled={busy}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
              >
                + Add blank row
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}
          {result ? (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{result}</p>
          ) : null}
          {warnings.length > 0 ? (
            <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {warnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Review table */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {staged.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-slate-400">
              No candidates staged yet. Upload a file to begin.
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {FIELDS.map((f) => (
                    <th key={f.key} className="px-2 py-1.5">
                      {f.label}
                    </th>
                  ))}
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {staged.map((c, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {FIELDS.map((f) => (
                      <td key={f.key} className="px-1 py-1">
                        <input
                          value={(c[f.key] as string | null) ?? ""}
                          onChange={(e) => updateRow(i, f.key, e.target.value)}
                          placeholder={f.placeholder}
                          className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                        />
                      </td>
                    ))}
                    <td className="px-1 py-1 text-right">
                      <button
                        onClick={() => removeRow(i)}
                        className="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                        aria-label="Remove row"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 p-4">
          <span className="text-xs text-slate-500">
            {staged.length > 0
              ? `${staged.length} candidate${staged.length === 1 ? "" : "s"} ready`
              : "Blank fields can be filled in later."}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              disabled={saving}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Close
            </button>
            <button
              onClick={handleCreate}
              disabled={busy || staged.length === 0}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving
                ? "Creating…"
                : `Create ${staged.length || ""} candidate${staged.length === 1 ? "" : "s"}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
