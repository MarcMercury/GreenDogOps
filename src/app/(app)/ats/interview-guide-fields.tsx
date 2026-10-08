"use client";

import {
  checkedOptions,
  fieldHasOptions,
  YES_NO_OPTIONS,
  type RecruitingFormField,
} from "@/lib/ats/forms";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50";

/**
 * An interview guide's questions as interviewer inputs (`a_<id>`), read back
 * by readInterviewResponses(). Every question is optional for the
 * interviewer; `values` pre-fills answers when an interview is edited.
 */
export function GuideQuestions({
  fields,
  values = {},
  disabled = false,
}: {
  fields: RecruitingFormField[];
  values?: Record<string, string | null | undefined>;
  disabled?: boolean;
}) {
  const numbers = new Map<string, number>();
  for (const f of fields) {
    if (f.type !== "section" && f.type !== "file") numbers.set(f.id, numbers.size + 1);
  }
  return (
    <div className="space-y-3">
      {fields.map((f) => {
        if (f.type === "file") return null;
        if (f.type === "section") {
          return (
            <div key={f.id} className="border-b border-slate-200 pb-1 pt-3 first:pt-0">
              <p className="text-sm font-semibold text-slate-800">{f.label}</p>
              {f.description && <p className="text-xs text-slate-500">{f.description}</p>}
            </div>
          );
        }
        const name = `a_${f.id}`;
        const value = values[f.id] ?? "";
        const label = (
          <span className="text-xs font-medium text-slate-600">
            {numbers.get(f.id)}. {f.label}
            {f.description && (
              <span className="mt-0.5 block font-normal text-slate-400">💡 {f.description}</span>
            )}
          </span>
        );

        if (f.type === "checkboxes") {
          const checked = new Set(checkedOptions(value, f.options));
          return (
            <fieldset key={f.id} className="flex flex-col gap-1">
              <legend className="mb-1">{label}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {f.options.map((o) => (
                  <label key={o} className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name={name}
                      value={o}
                      defaultChecked={checked.has(o)}
                      disabled={disabled}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    {o}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }

        if (fieldHasOptions(f.type) || f.type === "yes_no") {
          const options = f.type === "yes_no" ? [...YES_NO_OPTIONS] : f.options;
          // Short scales (1–5, Yes/No) read faster as buttons than a dropdown.
          const inline = options.length <= 6 && options.every((o) => o.length <= 24);
          if (inline) {
            return (
              <fieldset key={f.id} className="flex flex-col gap-1">
                <legend className="mb-1">{label}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {options.map((o) => (
                    <label key={o} className="flex items-center gap-1.5 text-sm text-slate-700">
                      <input
                        type="radio"
                        name={name}
                        value={o}
                        defaultChecked={value === o}
                        disabled={disabled}
                        className="h-4 w-4 border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      {o}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          }
          return (
            <label key={f.id} className="flex flex-col gap-1">
              {label}
              <select name={name} defaultValue={value} disabled={disabled} className={`${inputCls} bg-white`}>
                <option value="">—</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                {value && !options.includes(value) && <option value={value}>{value}</option>}
              </select>
            </label>
          );
        }

        if (f.type === "short_text" || f.type === "number" || f.type === "date") {
          return (
            <label key={f.id} className="flex flex-col gap-1">
              {label}
              <input
                name={name}
                type={f.type === "short_text" ? "text" : f.type}
                defaultValue={value}
                disabled={disabled}
                className={`${inputCls} max-w-md`}
              />
            </label>
          );
        }

        return (
          <label key={f.id} className="flex flex-col gap-1">
            {label}
            <textarea name={name} rows={2} defaultValue={value} disabled={disabled} className={inputCls} />
          </label>
        );
      })}
    </div>
  );
}
