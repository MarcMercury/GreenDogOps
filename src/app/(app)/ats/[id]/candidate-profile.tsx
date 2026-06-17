"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { CandidateRow, PersonInterview } from "@/lib/ats/types";
import {
  INTERVIEW_TYPE_LABELS,
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_STATUS_BADGE,
  INTERVIEW_RECOMMENDATION_LABELS,
  INTERVIEW_GRADE_OPTIONS,
  CSR_PHONE_SCREEN_QUESTIONS,
} from "@/lib/ats/types";
import { CandidateForm } from "./candidate-form";
import { saveInterview, deleteInterview, type SaveResult } from "../actions";

type TabKey = "profile" | "interviews";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "profile", label: "Profile" },
  { key: "interviews", label: "Interview Tracking" },
];

export function CandidateProfile({
  row,
  interviews,
  isAdmin = false,
}: {
  row: CandidateRow;
  interviews: PersonInterview[];
  isAdmin?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("profile");
  const rec = row.person_recruiting;

  const heading =
    row.full_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    "Candidate";

  return (
    <div className="mt-3 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{heading}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {rec?.target_title ?? "Candidate"}
            {rec?.pipeline ? ` · ${rec.pipeline}` : ""}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto border-b border-slate-200">
        <nav className="-mb-px flex gap-1">
          {TABS.map((t) => {
            const active = t.key === activeTab;
            const count = t.key === "interviews" ? interviews.length : 0;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "border-emerald-600 text-emerald-700"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {t.label}
                {t.key === "interviews" && count > 0 && (
                  <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Profile form stays mounted so unsaved edits survive a tab switch. */}
      <CandidateForm row={row} isAdmin={isAdmin} hidden={activeTab !== "profile"} />

      {activeTab === "interviews" && (
        <InterviewsPanel personId={row.id} interviews={interviews} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </label>
  );
}

function Select({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function AddButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function DeleteButton({
  onConfirm,
  label = "this item",
}: {
  onConfirm: () => void;
  label?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Delete ${label}? This cannot be undone.`)) {
          start(() => onConfirm());
        }
      }}
      className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Interview tracking
// ---------------------------------------------------------------------------

function InterviewsPanel({
  personId,
  interviews,
}: {
  personId: string;
  interviews: PersonInterview[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [showQuestions, setShowQuestions] = useState(false);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => saveInterview(personId, prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) {
      formRef.current?.reset();
    }
  }, [result]);

  const typeOptions = Object.entries(INTERVIEW_TYPE_LABELS).map(
    ([value, label]) => ({ value, label }),
  );
  const statusOptions = Object.entries(INTERVIEW_STATUS_LABELS).map(
    ([value, label]) => ({ value, label }),
  );
  const recommendationOptions = Object.entries(
    INTERVIEW_RECOMMENDATION_LABELS,
  ).map(([value, label]) => ({ value, label }));
  const gradeOptions = INTERVIEW_GRADE_OPTIONS.map((g) => ({
    value: g,
    label: g,
  }));

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Add an interview
        </h2>
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Interview date" name="interview_date" type="date" />
            <Select label="Type" name="interview_type" options={typeOptions} />
            <Select
              label="Status"
              name="status"
              options={statusOptions}
              defaultValue="scheduled"
            />
            <Field label="Interviewer" name="interviewer" />
            <Field label="Location" name="location" />
            <Select label="Overall grade" name="overall_grade" options={gradeOptions} />
            <Select
              label="Recommendation"
              name="recommendation"
              options={recommendationOptions}
            />
            <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
              <span className="text-xs font-medium text-slate-500">
                Summary / overall notes
              </span>
              <textarea
                name="summary"
                rows={3}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/60">
            <button
              type="button"
              onClick={() => setShowQuestions((s) => !s)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-slate-700"
            >
              <span>CSR phone-screen questions (optional)</span>
              <span className="text-slate-400">{showQuestions ? "▲" : "▼"}</span>
            </button>
            <div className={showQuestions ? "space-y-3 px-4 pb-4" : "hidden"}>
              {CSR_PHONE_SCREEN_QUESTIONS.map((q, i) => (
                <label key={i} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">
                    {i + 1}. {q}
                  </span>
                  <input type="hidden" name={`question_${i}`} value={q} />
                  <textarea
                    name={`answer_${i}`}
                    rows={2}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <AddButton>Add interview</AddButton>
            {result?.ok === false && (
              <span className="text-sm text-red-600">{result.error}</span>
            )}
          </div>
        </form>
      </section>

      {interviews.length === 0 ? (
        <EmptyState>No interviews logged yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {interviews.map((iv) => (
            <InterviewCard key={iv.id} personId={personId} interview={iv} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InterviewCard({
  personId,
  interview,
}: {
  personId: string;
  interview: PersonInterview;
}) {
  const [open, setOpen] = useState(false);
  const answered = (interview.responses ?? []).filter((r) => r.answer);
  const statusBadge =
    INTERVIEW_STATUS_BADGE[interview.status] ?? "bg-slate-100 text-slate-500";

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            {interview.interview_type
              ? (INTERVIEW_TYPE_LABELS[interview.interview_type] ??
                interview.interview_type)
              : "Interview"}
            {interview.overall_grade && (
              <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-bold text-emerald-700">
                Grade {interview.overall_grade}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {fmtDate(interview.interview_date)}
            {interview.interviewer ? ` · ${interview.interviewer}` : ""}
            {interview.location ? ` · ${interview.location}` : ""}
            {interview.recommendation
              ? ` · ${INTERVIEW_RECOMMENDATION_LABELS[interview.recommendation] ?? interview.recommendation}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge}`}
          >
            {INTERVIEW_STATUS_LABELS[interview.status] ?? interview.status}
          </span>
          <DeleteButton
            label="this interview"
            onConfirm={() => deleteInterview(personId, interview.id)}
          />
        </div>
      </div>

      {interview.summary && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
          {interview.summary}
        </p>
      )}

      {answered.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
          >
            {open ? "Hide" : "Show"} responses ({answered.length})
          </button>
          {open && (
            <dl className="mt-2 space-y-2">
              {answered.map((r, i) => (
                <div key={i}>
                  <dt className="text-xs font-semibold text-slate-600">
                    {r.question}
                  </dt>
                  <dd className="whitespace-pre-wrap text-sm text-slate-700">
                    {r.answer}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </li>
  );
}
