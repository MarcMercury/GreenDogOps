"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ACCEPTED_LEAD_STAGE,
  RECRUITING_PIPELINE_OPTIONS,
  RECRUITING_SOURCE_OPTIONS,
  RECRUITING_STAGE_OPTIONS,
  type PositionRow,
} from "@/lib/ats/types";
import { PhoneInput } from "@/lib/shared/phone-input";
import { createCandidate } from "./actions";
import { PositionPicker } from "./position-picker";
import { ZipCityFields } from "./zip-city-fields";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const labelCls = "text-xs font-medium text-slate-500";

function Field({
  label,
  name,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      {type === "tel" ? (
        <PhoneInput name={name} placeholder={placeholder} className={inputCls} />
      ) : (
        <input
          name={name}
          type={type}
          placeholder={placeholder}
          step={type === "number" ? "any" : undefined}
          className={inputCls}
        />
      )}
    </label>
  );
}

function Select({
  label,
  name,
  options,
}: {
  label: string;
  name: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      <select name={name} defaultValue="" className={inputCls}>
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

export function AddCandidateDialog({
  open,
  onClose,
  positions,
}: {
  open: boolean;
  onClose: () => void;
  positions: PositionRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) return null;

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createCandidate(formData);
      if (res.ok) {
        if (res.warning) alert(res.warning);
        onClose();
        router.push(`/ats/${res.id}`);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form action={submit}>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
            <h2 className="text-lg font-bold text-slate-900">Add Candidate</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-500 hover:bg-slate-50"
            >
              ✕
            </button>
          </div>

          <div className="space-y-5 p-5">
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Candidate
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="First name" name="first_name" />
                <Field label="Last name" name="last_name" />
                <Field label="Email" name="email" type="email" />
                <Field label="Cell phone" name="phone_mobile" type="tel" />
                <Field label="Home phone" name="phone_home" type="tel" />
                <Field label="Other phone" name="phone_other" type="tel" />
                <ZipCityFields inputClassName={inputCls} labelClassName={labelCls} />
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Pipeline
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PositionPicker
                  positions={positions}
                  className={inputCls}
                  labelClassName={labelCls}
                />
                <Select
                  label="Pipeline"
                  name="pipeline"
                  options={RECRUITING_PIPELINE_OPTIONS}
                />
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Stage</span>
                  <select name="stage" defaultValue={ACCEPTED_LEAD_STAGE} className={inputCls}>
                    {RECRUITING_STAGE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <Select
                  label="Source (found on)"
                  name="source"
                  options={RECRUITING_SOURCE_OPTIONS}
                />
                <Field label="Interview date" name="interview_date" type="date" />
                <Field label="Score (0–10)" name="score" type="number" />
                <Field label="Follow-up date" name="follow_up_date" type="date" />
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    name="keep_for_future"
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Keep for future
                </label>
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Documents
              </h3>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>
                  Resume, cover letter, etc. — attached to the candidate&apos;s Documents tab
                </span>
                <input
                  name="documents"
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.rtf,.txt,.odt,.pages,.png,.jpg,.jpeg,.webp,.heic"
                  className="text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-emerald-700 hover:file:bg-emerald-100"
                />
              </label>
            </section>

            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Notes
              </h3>
              <div className="grid grid-cols-1 gap-4">
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Status notes</span>
                  <textarea name="status_notes" rows={2} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Recruiting notes</span>
                  <textarea name="notes" rows={2} className={inputCls} />
                </label>
              </div>
            </section>
          </div>

          <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? "Adding…" : "Add candidate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
