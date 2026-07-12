"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  parseCandidateList,
  parseResumeFile,
  createCandidates,
  createResumeCandidate,
} from "./actions";
import { emptyCandidate, type ParsedCandidate } from "@/lib/ats/import-types";
import {
  RECRUITING_SOURCE_OPTIONS,
  RECRUITING_POSITION_OPTIONS,
} from "@/lib/ats/types";

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

const POSITION_DATALIST_ID = "ats-position-options";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Small labeled input used by the resume detail editor.
function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  list?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type={type}
        list={list}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </label>
  );
}

function SourceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const known = value === "" || RECRUITING_SOURCE_OPTIONS.some((o) => o.value === value);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <option value="">—</option>
        {RECRUITING_SOURCE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {!known && <option value={value}>{value} (current)</option>}
      </select>
    </label>
  );
}

// Full single-candidate form shown after a resume is parsed so the user can
// review the auto-filled profile and add the pieces a resume never carries
// (lead source, position applying for, application date).
function ResumeEditor({
  candidate,
  onChange,
}: {
  candidate: ParsedCandidate;
  onChange: (patch: Partial<ParsedCandidate>) => void;
}) {
  const v = (k: keyof ParsedCandidate) => (candidate[k] as string | null) ?? "";
  const set = (k: keyof ParsedCandidate) => (val: string) =>
    onChange({ [k]: val === "" ? null : val } as Partial<ParsedCandidate>);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Contact
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="First name" value={v("first_name")} onChange={set("first_name")} />
          <TextField label="Last name" value={v("last_name")} onChange={set("last_name")} />
          <TextField label="Email" type="email" value={v("email")} onChange={set("email")} />
          <TextField label="Cell phone" type="tel" value={v("phone_mobile")} onChange={set("phone_mobile")} />
          <TextField label="Home phone" type="tel" value={v("phone_home")} onChange={set("phone_home")} />
          <TextField label="Other phone" type="tel" value={v("phone_other")} onChange={set("phone_other")} />
          <TextField label="Date of birth" type="date" value={v("date_of_birth")} onChange={set("date_of_birth")} />
          <TextField label="ZIP / postal code" value={v("postal_code")} onChange={set("postal_code")} />
        </div>
      </section>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Application details
        </h4>
        <p className="mb-3 text-xs text-slate-500">
          A resume rarely states these — fill them in before creating the candidate.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            label="Position applying for"
            value={v("target_title")}
            onChange={set("target_title")}
            placeholder="e.g. CSR"
            list={POSITION_DATALIST_ID}
          />
          <SourceField label="Lead source" value={v("source")} onChange={set("source")} />
          <TextField
            label="Application date"
            type="date"
            value={v("application_date")}
            onChange={set("application_date")}
          />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Summary
        </h4>
        <textarea
          rows={4}
          value={v("notes")}
          onChange={(e) => set("notes")(e.target.value)}
          placeholder="Experience, key skills, certifications, education…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </section>
    </div>
  );
}

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

  // The original resume file, kept so it can be attached to the new candidate's
  // Documents tab when they are created (resume mode only).
  const [resumeFile, setResumeFile] = useState<File | null>(null);

  // Bulk-fill controls for list imports (only touch rows missing a value).
  const [bulkPosition, setBulkPosition] = useState("");
  const [bulkSource, setBulkSource] = useState("");
  const [bulkAppliedDate, setBulkAppliedDate] = useState("");

  if (!open) return null;

  function reset() {
    setStaged([]);
    setWarnings([]);
    setError(null);
    setResult(null);
    setResumeFile(null);
    setBulkPosition("");
    setBulkSource("");
    setBulkAppliedDate("");
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
        // Keep the original file so it can be saved to the new candidate's
        // Documents tab, and default the application date to today (upload day).
        setResumeFile(file);
        setStaged([
          { ...res.candidate, application_date: res.candidate.application_date ?? todayISO() },
        ]);
        setWarnings([]);
      }
    });
  }

  function updateRow(index: number, key: keyof ParsedCandidate, value: string) {
    setStaged((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [key]: value === "" ? null : value } : c)),
    );
  }

  function patchResume(patch: Partial<ParsedCandidate>) {
    setStaged((prev) => prev.map((c, i) => (i === 0 ? { ...c, ...patch } : c)));
  }

  function removeRow(index: number) {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  }

  function addBlankRow() {
    setStaged((prev) => [...prev, emptyCandidate()]);
  }

  function applyBulk(key: keyof ParsedCandidate, value: string) {
    const v = value.trim();
    if (!v) return;
    setStaged((prev) =>
      prev.map((c) => {
        const existing = (c[key] as string | null) ?? "";
        return existing.trim() ? c : { ...c, [key]: v };
      }),
    );
  }

  function handleCreate() {
    setError(null);
    startSave(async () => {
      // Resume mode: create the single candidate and attach the uploaded file
      // to their Documents tab in one server call.
      if (mode === "resume") {
        const res = await createResumeCandidate(staged[0], resumeFile);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const parts = ["Created candidate."];
        if (resumeFile) {
          parts.push(res.documentSaved ? "Resume saved to Documents." : "Resume file could not be saved.");
        }
        if (!res.documentSaved && res.documentError) parts.push(res.documentError);
        setResult(parts.join(" "));
        setStaged([]);
        setResumeFile(null);
        setWarnings([]);
        router.refresh();
        return;
      }

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
  const showResumeEditor = mode === "resume" && staged.length > 0;

  // Count list rows still missing a position / source for the bulk-fill hints.
  const missingPosition = staged.filter((c) => !(c.target_title ?? "").trim()).length;
  const missingSource = staged.filter((c) => !(c.source ?? "").trim()).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <datalist id={POSITION_DATALIST_ID}>
        {RECRUITING_POSITION_OPTIONS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
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
              ? "CSV or Excel with columns like Name, Email, Phone, Position. PDF/image rosters are read with AI. After uploading you can bulk-fill any missing Position or Lead source."
              : "PDF, Word, image, or text. The system extracts contact details and a summary, then you fill in the position, lead source, and application date."}
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
            {mode === "list" && staged.length > 0 ? (
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

        {/* Bulk-fill bar (list mode only) */}
        {mode === "list" && staged.length > 0 ? (
          <div className="border-b border-slate-200 bg-slate-50 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Bulk fill missing fields
            </h4>
            <p className="mt-0.5 text-xs text-slate-500">
              Only rows that are still blank are updated.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-500">
                  Position {missingPosition > 0 ? `(${missingPosition} blank)` : ""}
                </span>
                <div className="flex gap-2">
                  <input
                    value={bulkPosition}
                    list={POSITION_DATALIST_ID}
                    placeholder="e.g. CSR"
                    onChange={(e) => setBulkPosition(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <button
                    onClick={() => applyBulk("target_title", bulkPosition)}
                    disabled={!bulkPosition.trim()}
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-500">
                  Lead source {missingSource > 0 ? `(${missingSource} blank)` : ""}
                </span>
                <div className="flex gap-2">
                  <select
                    value={bulkSource}
                    onChange={(e) => setBulkSource(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">—</option>
                    {RECRUITING_SOURCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => applyBulk("source", bulkSource)}
                    disabled={!bulkSource.trim()}
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-500">Application date</span>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={bulkAppliedDate}
                    onChange={(e) => setBulkAppliedDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <button
                    onClick={() => applyBulk("application_date", bulkAppliedDate)}
                    disabled={!bulkAppliedDate.trim()}
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Review area */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {staged.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-slate-400">
              {mode === "resume"
                ? "No resume parsed yet. Upload a resume to begin."
                : "No candidates staged yet. Upload a file to begin."}
            </div>
          ) : showResumeEditor ? (
            <ResumeEditor candidate={staged[0]} onChange={patchResume} />
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
                          list={f.key === "target_title" ? POSITION_DATALIST_ID : undefined}
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
