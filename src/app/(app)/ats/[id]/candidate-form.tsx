"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { CandidateRow } from "@/lib/ats/types";
import { updateCandidate, hireCandidate, type SaveResult } from "../actions";

function Field({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        step={type === "number" ? "any" : undefined}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </label>
  );
}

function TextArea({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
}) {
  return (
    <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <textarea
        name={name}
        rows={3}
        defaultValue={defaultValue ?? ""}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

function HireButton({ personId }: { personId: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (
          !confirm(
            "Hire this candidate? They will become an Employee and move to the HR roster.",
          )
        ) {
          e.preventDefault();
        }
      }}
      formAction={() => hireCandidate(personId)}
      className="rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
    >
      {pending ? "Hiring…" : "Hire → Employee"}
    </button>
  );
}

export function CandidateForm({ row }: { row: CandidateRow }) {
  const rec = row.person_recruiting;
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => updateCandidate(row.id, prev, fd),
    null,
  );

  const heading =
    row.full_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    "Candidate";

  return (
    <form action={formAction} className="mt-3 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{heading}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {rec?.target_title ?? "Candidate"}
            {rec?.pipeline ? ` · ${rec.pipeline}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {result?.ok === true && (
            <span className="text-sm text-emerald-700">Saved ✓</span>
          )}
          {result?.ok === false && (
            <span className="text-sm text-red-600">{result.error}</span>
          )}
          <HireButton personId={row.id} />
          <SaveButton />
        </div>
      </div>

      <Section title="Candidate">
        <Field label="First name" name="first_name" defaultValue={row.first_name} />
        <Field label="Last name" name="last_name" defaultValue={row.last_name} />
        <Field label="Email" name="email" type="email" defaultValue={row.email} />
        <Field label="Phone" name="phone_mobile" defaultValue={row.phone_mobile} />
      </Section>

      <Section title="Pipeline">
        <Field label="Position applied for" name="target_title" defaultValue={rec?.target_title} />
        <Field label="Pipeline" name="pipeline" defaultValue={rec?.pipeline} />
        <Field label="Stage" name="stage" defaultValue={rec?.stage} />
        <Field label="Source (found on)" name="source" defaultValue={rec?.source} />
        <Field label="Interview date" name="interview_date" type="date" defaultValue={rec?.interview_date} />
        <Field label="Score" name="score" type="number" defaultValue={rec?.score} />
        <Field label="Resume" name="resume_url" defaultValue={rec?.resume_url} />
        <Field label="Follow-up date" name="follow_up_date" type="date" defaultValue={rec?.follow_up_date} />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            name="keep_for_future"
            type="checkbox"
            defaultChecked={rec?.keep_for_future ?? false}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          Keep for future
        </label>
      </Section>

      <Section title="Notes">
        <TextArea label="Status notes" name="status_notes" defaultValue={rec?.status_notes} />
        <TextArea label="Recruiting notes" name="notes" defaultValue={rec?.notes} />
      </Section>

      <div className="flex justify-end gap-3 pb-8">
        <HireButton personId={row.id} />
        <SaveButton />
      </div>
    </form>
  );
}
