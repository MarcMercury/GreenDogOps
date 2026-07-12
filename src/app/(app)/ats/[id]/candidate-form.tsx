"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  type CandidateRow,
  RECRUITING_PIPELINE_OPTIONS,
  RECRUITING_SOURCE_OPTIONS,
  RECRUITING_POSITION_OPTIONS,
} from "@/lib/ats/types";
import { OpportunityTypeField } from "@/app/(app)/_components/opportunity-type-field";
import { CopyForSlackButton } from "./copy-for-slack";
import { buildCandidateSummary } from "@/lib/ats/slack-summary";
import { updateCandidate, hireCandidate, deleteCandidate, type SaveResult } from "../actions";

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  list,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  list?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        name={name}
        type={type}
        list={list}
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

function Select({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  const current = defaultValue == null ? "" : String(defaultValue);
  const known = current === "" || options.some((o) => o.value === current);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        name={name}
        defaultValue={current}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {!known && <option value={current}>{current} (current)</option>}
      </select>
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

function DeleteButton({ personId }: { personId: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (
          !confirm(
            "Permanently delete this candidate record? This cannot be undone.",
          )
        ) {
          e.preventDefault();
        }
      }}
      formAction={() => deleteCandidate(personId)}
      className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete record"}
    </button>
  );
}

export function CandidateForm({
  row,
  isAdmin = false,
  canEdit = false,
  hidden = false,
}: {
  row: CandidateRow;
  isAdmin?: boolean;
  canEdit?: boolean;
  hidden?: boolean;
}) {
  const rec = row.person_recruiting;
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => updateCandidate(row.id, prev, fd),
    null,
  );

  return (
    <form action={formAction} className={`mt-3 space-y-5 ${hidden ? "hidden" : ""}`}>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {result?.ok === true && (
          <span className="text-sm text-emerald-700">Saved ✓</span>
        )}
        {result?.ok === false && (
          <span className="text-sm text-red-600">{result.error}</span>
        )}
        <CopyForSlackButton
          label="Copy candidate summary"
          getText={() => buildCandidateSummary(row)}
        />
        {canEdit && (
          <>
            <HireButton personId={row.id} />
            <SaveButton />
          </>
        )}
      </div>

      <Section title="Candidate">
        <Field label="First name" name="first_name" defaultValue={row.first_name} />
        <Field label="Last name" name="last_name" defaultValue={row.last_name} />
        <Field label="Email" name="email" type="email" defaultValue={row.email} />
        <Field label="Cell phone" name="phone_mobile" type="tel" defaultValue={row.phone_mobile} />
        <Field label="Home phone" name="phone_home" type="tel" defaultValue={row.phone_home} />
        <Field label="Other phone" name="phone_other" type="tel" defaultValue={row.phone_other} />
        <Field label="Date of birth" name="date_of_birth" type="date" defaultValue={row.date_of_birth} />
        <Field label="ZIP / postal code" name="postal_code" defaultValue={row.postal_code} />
      </Section>

      <Section title="Pipeline">
        <Field
          label="Position applied for"
          name="target_title"
          defaultValue={rec?.target_title}
          list="recruiting-position-options"
        />
        <datalist id="recruiting-position-options">
          {RECRUITING_POSITION_OPTIONS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <OpportunityTypeField defaultValue={row.opportunity_type} />
        <Select label="Pipeline" name="pipeline" defaultValue={rec?.pipeline} options={RECRUITING_PIPELINE_OPTIONS} />
        <Field label="Stage" name="stage" defaultValue={rec?.stage} />
        <Select label="Source (found on)" name="source" defaultValue={rec?.source} options={RECRUITING_SOURCE_OPTIONS} />
        <Field label="Application date" name="application_date" type="date" defaultValue={rec?.application_date} />
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
        {isAdmin && <DeleteButton personId={row.id} />}
        {canEdit && (
          <>
            <HireButton personId={row.id} />
            <SaveButton />
          </>
        )}
      </div>
    </form>
  );
}
