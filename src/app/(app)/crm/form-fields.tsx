"use client";

import { useFormStatus } from "react-dom";
import { useState, useTransition } from "react";

export function Field({
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

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Labeled <select> for low-option fields. To avoid losing legacy data, any
 * existing `defaultValue` that isn't part of `options` is preserved as an
 * extra "… (current)" choice so it stays selected and saveable.
 */
export function Select({
  label,
  name,
  defaultValue,
  options,
  className,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  options: ReadonlyArray<SelectOption>;
  className?: string;
}) {
  const current = defaultValue == null ? "" : String(defaultValue);
  const known = current === "" || options.some((o) => o.value === current);
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
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
        {!known && (
          <option value={current}>{current} (current)</option>
        )}
      </select>
    </label>
  );
}

/**
 * Input backed by a <datalist> of suggestions. Use for higher-cardinality
 * fields where we still want consistent suggestions but must allow free text.
 */
export function ComboField({
  label,
  name,
  defaultValue,
  options,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  options: ReadonlyArray<string | SelectOption>;
  placeholder?: string;
}) {
  const listId = `dl-${name}`;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        name={name}
        list={listId}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      <datalist id={listId}>
        {options.map((o) => {
          const value = typeof o === "string" ? o : o.value;
          const label = typeof o === "string" ? undefined : o.label;
          return <option key={value} value={value} label={label} />;
        })}
      </datalist>
    </label>
  );
}

export function TextArea({
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

export function Checkbox({
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

// Ordered Mon→Sun. `match` holds the tokens we recognize when parsing legacy
// free-text schedules (e.g. "TU & TH ONLY") back into selected days.
const WEEKDAYS: { value: string; label: string; match: string[] }[] = [
  { value: "Mon", label: "Mon", match: ["MONDAY", "MON", "MO"] },
  { value: "Tue", label: "Tue", match: ["TUESDAY", "TUES", "TUE", "TU"] },
  { value: "Wed", label: "Wed", match: ["WEDNESDAY", "WED", "WE"] },
  { value: "Thu", label: "Thu", match: ["THURSDAY", "THURS", "THU", "TH"] },
  { value: "Fri", label: "Fri", match: ["FRIDAY", "FRI", "FR"] },
  { value: "Sat", label: "Sat", match: ["SATURDAY", "SAT", "SA"] },
  { value: "Sun", label: "Sun", match: ["SUNDAY", "SUN", "SU"] },
];

/** Which days a stored free-text/comma schedule string selects. */
function parseWeekdays(value: string | null | undefined): Set<string> {
  const selected = new Set<string>();
  if (!value) return selected;
  const tokens = value.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  for (const day of WEEKDAYS) {
    if (day.match.some((m) => tokens.includes(m))) selected.add(day.value);
  }
  return selected;
}

/**
 * Multi-select for days of the week, rendered as toggle chips. Selected days
 * post as repeated `name` values; the server joins them into a "Mon, Wed"
 * string. Existing free-text schedules are parsed into the initial selection.
 */
export function DaysSelect({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(() =>
    parseWeekdays(defaultValue),
  );
  const toggle = (value: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  return (
    <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAYS.map((d) => {
          const active = selected.has(d.value);
          return (
            <button
              type="button"
              key={d.value}
              onClick={() => toggle(d.value)}
              aria-pressed={active}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {d.label}
            </button>
          );
        })}
      </div>
      {[...selected].map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}
    </div>
  );
}

/**
 * Color-coded Red / Yellow / Green select (formerly "Doc recommendation").
 * The control's background reflects the chosen level for at-a-glance scanning.
 */
export function RecommendationLevelField({
  label,
  name,
  defaultValue,
  options,
  styles,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  options: ReadonlyArray<SelectOption>;
  styles: Record<string, { swatch: string; select: string }>;
}) {
  const initial = defaultValue == null ? "" : String(defaultValue);
  const [value, setValue] = useState(initial);
  const known = initial === "" || options.some((o) => o.value === initial);
  const style = styles[value]?.select ?? "border-slate-300 bg-white text-slate-800";
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`rounded-lg border px-3 py-2 text-sm font-medium shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${style}`}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {!known && <option value={initial}>{initial} (current)</option>}
      </select>
    </label>
  );
}

export function Section({
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

export function SaveButton({ canEdit = true, label }: { canEdit?: boolean; label?: string }) {
  const { pending } = useFormStatus();
  if (!canEdit) {
    return <span className="text-sm text-slate-400">Read-only access</span>;
  }
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : (label ?? "Save changes")}
    </button>
  );
}

/**
 * Delete control for a CRM record. Asks for confirmation, then runs the given
 * server action (which redirects to the list view on success). Rendered as a
 * plain button so it can live inside the surrounding edit <form> without
 * submitting it.
 */
export function DeleteButton({
  recordLabel,
  onDelete,
}: {
  recordLabel: string;
  onDelete: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-sm text-red-600">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              `Delete "${recordLabel}"? This permanently removes the record and cannot be undone.`,
            )
          )
            return;
          setError(null);
          startTransition(async () => {
            const result = await onDelete();
            if (result && !result.ok) setError(result.error);
          });
        }}
        className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
    </div>
  );
}
