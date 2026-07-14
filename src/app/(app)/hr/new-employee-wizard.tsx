"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  OPPORTUNITY_GROUPS,
  OPPORTUNITY_TYPES,
} from "@/lib/shared/opportunity-types";
import { SCHEDULE_TYPE_OPTIONS } from "@/lib/hr/types";
import { createEmployee } from "./actions";

type StepKey = "personal" | "employment" | "review";

const STEPS: Array<{ key: StepKey; title: string }> = [
  { key: "personal", title: "Personal" },
  { key: "employment", title: "Employment" },
  { key: "review", title: "Review" },
];

interface FormState {
  first_name: string;
  last_name: string;
  grid_name: string;
  email: string;
  phone_mobile: string;
  date_of_birth: string;
  postal_code: string;
  status: string;
  work_location_type: string;
  opportunity_type: string;
  adp_job_title: string;
  offer_title: string;
  flsa_status: string;
  work_schedule: string;
  schedule_type: string;
  hire_date: string;
}

const EMPTY: FormState = {
  first_name: "",
  last_name: "",
  grid_name: "",
  email: "",
  phone_mobile: "",
  date_of_birth: "",
  postal_code: "",
  status: "employee",
  work_location_type: "in_house",
  opportunity_type: "w2_hire",
  adp_job_title: "",
  offer_title: "",
  flsa_status: "",
  work_schedule: "full_time",
  schedule_type: "",
  hire_date: "",
};

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options?: Array<{ value: string; label: string }>;
  children?: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <option value="">—</option>
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
    </label>
  );
}

export function NewEmployeeWizard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const step = STEPS[stepIdx];

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function reset() {
    setForm(EMPTY);
    setStepIdx(0);
    setError(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  const canAdvancePersonal =
    form.first_name.trim() !== "" || form.last_name.trim() !== "";

  function next() {
    setError(null);
    if (step.key === "personal" && !canAdvancePersonal) {
      setError("A first or last name is required.");
      return;
    }
    setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function back() {
    setError(null);
    setStepIdx((i) => Math.max(i - 1, 0));
  }

  function submit() {
    setError(null);
    const fd = new FormData();
    for (const [key, value] of Object.entries(form)) {
      if (value) fd.set(key, value);
    }
    startTransition(async () => {
      const result = await createEmployee(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close();
      router.push(`/hr/${result.id}`);
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700"
      >
        ＋ Add New Employee
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={close}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + stepper */}
        <div className="border-b border-slate-100 px-6 pb-4 pt-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">
              Add New Employee
            </h2>
            <button
              onClick={close}
              className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <ol className="mt-4 flex items-center gap-2">
            {STEPS.map((s, i) => (
              <li key={s.key} className="flex flex-1 items-center gap-2">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    i <= stepIdx
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {i + 1}
                </span>
                <span
                  className={`text-sm font-medium ${
                    i === stepIdx ? "text-slate-900" : "text-slate-400"
                  }`}
                >
                  {s.title}
                </span>
                {i < STEPS.length - 1 ? (
                  <span className="h-px flex-1 bg-slate-200" />
                ) : null}
              </li>
            ))}
          </ol>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {step.key === "personal" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="First name"
                value={form.first_name}
                onChange={(v) => set("first_name", v)}
                required
              />
              <TextField
                label="Last name"
                value={form.last_name}
                onChange={(v) => set("last_name", v)}
                required
              />
              <TextField
                label="Grid name"
                value={form.grid_name}
                onChange={(v) => set("grid_name", v)}
                placeholder="Shown on the schedule grid"
              />
              <TextField
                label="Email"
                type="email"
                value={form.email}
                onChange={(v) => set("email", v)}
              />
              <TextField
                label="Cell phone"
                type="tel"
                value={form.phone_mobile}
                onChange={(v) => set("phone_mobile", v)}
              />
              <TextField
                label="Date of birth"
                type="date"
                value={form.date_of_birth}
                onChange={(v) => set("date_of_birth", v)}
              />
              <TextField
                label="Postal code"
                value={form.postal_code}
                onChange={(v) => set("postal_code", v)}
              />
            </div>
          ) : null}

          {step.key === "employment" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                label="Status"
                value={form.status}
                onChange={(v) => set("status", v)}
                options={[
                  { value: "prospect", label: "Prospect" },
                  { value: "applicant", label: "Applicant" },
                  { value: "employee", label: "Employee" },
                  { value: "former", label: "Former" },
                  { value: "contractor", label: "Contractor" },
                ]}
              />
              <SelectField
                label="Work location"
                value={form.work_location_type}
                onChange={(v) => set("work_location_type", v)}
                options={[
                  { value: "in_house", label: "In-House" },
                  { value: "remote", label: "Remote" },
                  { value: "hybrid", label: "Hybrid" },
                ]}
              />
              <SelectField
                label="Opportunity type"
                value={form.opportunity_type}
                onChange={(v) => set("opportunity_type", v)}
              >
                {OPPORTUNITY_GROUPS.map((group) => (
                  <optgroup key={group} label={group}>
                    {OPPORTUNITY_TYPES.filter((o) => o.group === group).map(
                      (o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ),
                    )}
                  </optgroup>
                ))}
              </SelectField>
              <TextField
                label="ADP job title"
                value={form.adp_job_title}
                onChange={(v) => set("adp_job_title", v)}
              />
              <TextField
                label="Offer title"
                value={form.offer_title}
                onChange={(v) => set("offer_title", v)}
              />
              <SelectField
                label="FLSA status"
                value={form.flsa_status}
                onChange={(v) => set("flsa_status", v)}
                options={[
                  { value: "exempt", label: "Exempt" },
                  { value: "non_exempt", label: "Non-Exempt" },
                ]}
              />
              <SelectField
                label="Work schedule"
                value={form.work_schedule}
                onChange={(v) => set("work_schedule", v)}
                options={[
                  { value: "full_time", label: "Full-Time" },
                  { value: "part_time", label: "Part-Time" },
                  { value: "per_diem", label: "Per Diem" },
                  { value: "contractor", label: "Contractor" },
                ]}
              />
              <SelectField
                label="Schedule type"
                value={form.schedule_type}
                onChange={(v) => set("schedule_type", v)}
                options={SCHEDULE_TYPE_OPTIONS.map((v) => ({
                  value: v,
                  label: v,
                }))}
              />
              <TextField
                label="Hire date"
                type="date"
                value={form.hire_date}
                onChange={(v) => set("hire_date", v)}
              />
            </div>
          ) : null}

          {step.key === "review" ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <ReviewRow
                label="Name"
                value={
                  [form.first_name, form.last_name].filter(Boolean).join(" ") ||
                  "—"
                }
              />
              <ReviewRow label="Preferred name" value={form.preferred_name} />
              <ReviewRow label="Grid name" value={form.grid_name} />
              <ReviewRow label="Email" value={form.email} />
              <ReviewRow label="Cell phone" value={form.phone_mobile} />
              <ReviewRow label="Date of birth" value={form.date_of_birth} />
              <ReviewRow label="Postal code" value={form.postal_code} />
              <ReviewRow
                label="Status"
                value={STATUS_LABEL[form.status] ?? form.status}
              />
              <ReviewRow
                label="Work location"
                value={LOCATION_LABEL[form.work_location_type]}
              />
              <ReviewRow
                label="Opportunity type"
                value={
                  OPPORTUNITY_TYPES.find(
                    (o) => o.value === form.opportunity_type,
                  )?.label
                }
              />
              <ReviewRow label="ADP job title" value={form.adp_job_title} />
              <ReviewRow label="Offer title" value={form.offer_title} />
              <ReviewRow
                label="Work schedule"
                value={SCHEDULE_LABEL[form.work_schedule]}
              />
              <ReviewRow label="Schedule type" value={form.schedule_type} />
              <ReviewRow label="Hire date" value={form.hire_date} />
            </dl>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
          <button
            onClick={stepIdx === 0 ? close : back}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            {stepIdx === 0 ? "Cancel" : "Back"}
          </button>
          {step.key === "review" ? (
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? "Creating…" : "Create Employee"}
            </button>
          ) : (
            <button
              onClick={next}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-medium text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800">{value || "—"}</dd>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  prospect: "Prospect",
  applicant: "Applicant",
  employee: "Employee",
  former: "Former",
  contractor: "Contractor",
};

const LOCATION_LABEL: Record<string, string> = {
  in_house: "In-House",
  remote: "Remote",
  hybrid: "Hybrid",
};

const SCHEDULE_LABEL: Record<string, string> = {
  full_time: "Full-Time",
  part_time: "Part-Time",
  per_diem: "Per Diem",
  contractor: "Contractor",
};
