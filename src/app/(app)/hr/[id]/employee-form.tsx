"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { RosterRow } from "@/lib/hr/types";
import { updateEmployee, type SaveResult } from "../actions";

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        step={type === "number" ? "any" : undefined}
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
  options: Array<{ value: string; label: string }>;
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

function Checkbox({
  label,
  name,
  defaultChecked,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean | null;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked ?? false}
        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
      />
      {label}
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

function SaveBar() {
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

export function EmployeeForm({ row }: { row: RosterRow }) {
  const emp = row.person_employment;
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => updateEmployee(row.id, prev, fd),
    null,
  );

  const heading =
    row.full_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    row.grid_name ||
    "Employee";

  return (
    <form action={formAction} className="mt-3 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {heading}
        </h1>
        <div className="hidden items-center gap-3 sm:flex">
          {result?.ok === true && (
            <span className="text-sm text-emerald-700">Saved ✓</span>
          )}
          {result?.ok === false && (
            <span className="text-sm text-red-600">{result.error}</span>
          )}
          <SaveBar />
        </div>
      </div>

      <Section title="Personal">
        <Field label="First name" name="first_name" defaultValue={row.first_name} />
        <Field label="Last name" name="last_name" defaultValue={row.last_name} />
        <Field
          label="Preferred name"
          name="preferred_name"
          defaultValue={row.preferred_name}
        />
        <Field label="Grid name" name="grid_name" defaultValue={row.grid_name} />
        <Field label="Email" name="email" type="email" defaultValue={row.email} />
        <Field
          label="Mobile phone"
          name="phone_mobile"
          defaultValue={row.phone_mobile}
        />
        <Field
          label="Date of birth"
          name="date_of_birth"
          type="date"
          defaultValue={row.date_of_birth}
        />
        <Field
          label="Postal code"
          name="postal_code"
          defaultValue={row.postal_code}
        />
        <Select
          label="Work location"
          name="work_location_type"
          defaultValue={row.work_location_type}
          options={[
            { value: "in_house", label: "In-House" },
            { value: "remote", label: "Remote" },
            { value: "hybrid", label: "Hybrid" },
          ]}
        />
        <Select
          label="Status"
          name="status"
          defaultValue={row.status}
          options={[
            { value: "prospect", label: "Prospect" },
            { value: "applicant", label: "Applicant" },
            { value: "employee", label: "Employee" },
            { value: "former", label: "Former" },
            { value: "contractor", label: "Contractor" },
          ]}
        />
      </Section>

      <Section title="Job / Position">
        <Field
          label="ADP job title"
          name="adp_job_title"
          defaultValue={emp?.adp_job_title}
        />
        <Field
          label="Offer title"
          name="offer_title"
          defaultValue={emp?.offer_title}
        />
        <Select
          label="FLSA status"
          name="flsa_status"
          defaultValue={emp?.flsa_status}
          options={[
            { value: "exempt", label: "Exempt" },
            { value: "non_exempt", label: "Non-Exempt" },
          ]}
        />
        <Select
          label="Work schedule"
          name="work_schedule"
          defaultValue={emp?.work_schedule}
          options={[
            { value: "full_time", label: "Full-Time" },
            { value: "part_time", label: "Part-Time" },
            { value: "per_diem", label: "Per Diem" },
            { value: "contractor", label: "Contractor" },
          ]}
        />
        <Field
          label="Days per week"
          name="days_per_week"
          type="number"
          defaultValue={emp?.days_per_week}
        />
        <Field
          label="Hire date"
          name="hire_date"
          type="date"
          defaultValue={emp?.hire_date}
        />
        <Field
          label="Original hire date"
          name="original_hire_date"
          type="date"
          defaultValue={emp?.original_hire_date}
        />
      </Section>

      <Section title="Compensation">
        <Field label="Pay type" name="pay_type" defaultValue={emp?.pay_type} />
        <Field
          label="Hourly rate"
          name="current_rate"
          type="number"
          defaultValue={emp?.current_rate}
        />
        <Field
          label="Biweekly wage"
          name="biweekly_wage"
          type="number"
          defaultValue={emp?.biweekly_wage}
        />
        <Field
          label="Annual wages"
          name="annual_wages"
          type="number"
          defaultValue={emp?.annual_wages}
        />
        <Field
          label="Last review date"
          name="last_review_date"
          type="date"
          defaultValue={emp?.last_review_date}
        />
      </Section>

      <Section title="PTO">
        <Field
          label="Policy allotment"
          name="pto_policy_allotment"
          type="number"
          defaultValue={emp?.pto_policy_allotment}
        />
        <Field
          label="Used"
          name="pto_used"
          type="number"
          defaultValue={emp?.pto_used}
        />
        <Field
          label="Available"
          name="pto_available"
          type="number"
          defaultValue={emp?.pto_available}
        />
        <Field label="PTO notes" name="pto_notes" defaultValue={emp?.pto_notes} />
      </Section>

      <Section title="Continuing Education">
        <Field
          label="CE budget"
          name="ce_budget"
          type="number"
          defaultValue={emp?.ce_budget}
        />
        <Field
          label="CE used"
          name="ce_used"
          type="number"
          defaultValue={emp?.ce_used}
        />
        <Field
          label="CE remaining"
          name="ce_remaining"
          type="number"
          defaultValue={emp?.ce_remaining}
        />
      </Section>

      <Section title="Benefits">
        <Checkbox
          label="Enrolled in benefits"
          name="benefits_enrolled"
          defaultChecked={emp?.benefits_enrolled}
        />
        <Field
          label="Monthly cost"
          name="benefits_monthly"
          type="number"
          defaultValue={emp?.benefits_monthly}
        />
        <Field
          label="Annual cost"
          name="benefits_annual"
          type="number"
          defaultValue={emp?.benefits_annual}
        />
      </Section>

      <Section title="Separation">
        <Field
          label="Separation date"
          name="separation_date"
          type="date"
          defaultValue={emp?.separation_date}
        />
        <Select
          label="Separation type"
          name="separation_type"
          defaultValue={emp?.separation_type}
          options={[
            { value: "quit", label: "Quit" },
            { value: "fired", label: "Fired" },
            { value: "laid_off", label: "Laid Off" },
            { value: "other", label: "Other" },
          ]}
        />
        <Checkbox
          label="Separation letter signed"
          name="separation_letter_signed"
          defaultChecked={emp?.separation_letter_signed}
        />
        <Field
          label="Separation notes"
          name="separation_notes"
          defaultValue={emp?.separation_notes}
        />
      </Section>

      <Section title="Notes">
        <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
          <span className="text-xs font-medium text-slate-500">
            Internal notes
          </span>
          <textarea
            name="notes"
            rows={3}
            defaultValue={row.notes ?? ""}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 border-t border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-md sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-8 sm:pt-0">
        {result?.ok === true && (
          <span className="text-sm text-emerald-700">Saved ✓</span>
        )}
        {result?.ok === false && (
          <span className="text-sm text-red-600">{result.error}</span>
        )}
        <SaveBar />
      </div>
    </form>
  );
}
