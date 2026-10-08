"use client";

import {
  ACCEPTED_FILE_TYPES,
  YES_NO_OPTIONS,
  type RecruitingFormField,
} from "./forms";

export const publicInput =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

export function QuestionLabel({
  label,
  required,
  description,
  error,
  children,
  as = "label",
}: {
  label: string;
  required?: boolean;
  description?: string | null;
  error?: string;
  children: React.ReactNode;
  as?: "label" | "fieldset";
}) {
  const head = (
    <>
      <span className="text-sm font-medium text-slate-800">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
    </>
  );
  const tail = error && <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span>;
  if (as === "fieldset") {
    return (
      <fieldset className="block">
        <legend className="mb-1">{head}</legend>
        {children}
        {tail}
      </fieldset>
    );
  }
  return (
    <label className="block">
      {head}
      {children}
      {tail}
    </label>
  );
}

function Question({
  field,
  error,
  disabled,
}: {
  field: RecruitingFormField;
  error?: string;
  disabled?: boolean;
}) {
  const name = `a_${field.id}`;
  const common = { label: field.label, required: field.required, description: field.description, error };

  switch (field.type) {
    case "section":
      return (
        <div className="border-t border-slate-200 pt-4">
          <h2 className="text-base font-semibold text-slate-900">{field.label}</h2>
          {field.description && <p className="mt-0.5 text-sm text-slate-500">{field.description}</p>}
        </div>
      );
    case "long_text":
      return (
        <QuestionLabel {...common}>
          <textarea name={name} rows={4} required={field.required} disabled={disabled} className={publicInput} />
        </QuestionLabel>
      );
    case "number":
      return (
        <QuestionLabel {...common}>
          <input name={name} type="number" step="any" inputMode="decimal" required={field.required} disabled={disabled} className={publicInput} />
        </QuestionLabel>
      );
    case "date":
      return (
        <QuestionLabel {...common}>
          <input name={name} type="date" required={field.required} disabled={disabled} className={publicInput} />
        </QuestionLabel>
      );
    case "dropdown":
      return (
        <QuestionLabel {...common}>
          <select name={name} required={field.required} disabled={disabled} defaultValue="" className={publicInput}>
            <option value="">Choose…</option>
            {field.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </QuestionLabel>
      );
    case "multiple_choice":
    case "yes_no": {
      const options = field.type === "yes_no" ? [...YES_NO_OPTIONS] : field.options;
      return (
        <QuestionLabel {...common} as="fieldset">
          <div className={field.type === "yes_no" ? "flex gap-4" : "space-y-1.5"}>
            {options.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name={name}
                  value={o}
                  required={field.required}
                  disabled={disabled}
                  className="h-4 w-4 border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                {o}
              </label>
            ))}
          </div>
        </QuestionLabel>
      );
    }
    case "checkboxes":
      return (
        <QuestionLabel {...common} as="fieldset">
          <div className="space-y-1.5">
            {field.options.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name={name}
                  value={o}
                  disabled={disabled}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                {o}
              </label>
            ))}
          </div>
        </QuestionLabel>
      );
    case "file":
      return (
        <QuestionLabel {...common}>
          <input
            name={`file_${field.id}`}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            required={field.required}
            disabled={disabled}
            className={`${publicInput} file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1 file:text-sm file:font-medium file:text-emerald-700`}
          />
        </QuestionLabel>
      );
    default:
      return (
        <QuestionLabel {...common}>
          <input name={name} required={field.required} disabled={disabled} className={publicInput} />
        </QuestionLabel>
      );
  }
}

/** A form's questions, as the candidate sees them. */
export function FormQuestions({
  fields,
  errors = {},
  disabled,
}: {
  fields: RecruitingFormField[];
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-5">
      {fields.map((f) => (
        <Question key={f.id} field={f} error={errors[f.id]} disabled={disabled} />
      ))}
    </div>
  );
}

/**
 * Checkbox groups can't use `required`; check them (and anything the browser
 * missed) before submitting so a server round-trip never wipes the form.
 */
export function missingRequired(fields: RecruitingFormField[], form: HTMLFormElement): Record<string, string> {
  const fd = new FormData(form);
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (!f.required) continue;
    if (f.type === "checkboxes" && fd.getAll(`a_${f.id}`).length === 0) errors[f.id] = "Choose at least one.";
  }
  return errors;
}
