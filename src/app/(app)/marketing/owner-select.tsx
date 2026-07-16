"use client";

import { type PersonOption, personLabel } from "@/lib/marketing/types";

/**
 * Owner picker constrained to the HR roster. It stores the selected person's
 * display name so it drops straight into the existing `owner_name` / item
 * `owner` string fields without any schema change. Any pre-existing value that
 * isn't in the current roster is preserved as a labelled option so historical
 * free-text owners are never silently dropped.
 *
 * Pass `value`/`onChange` for controlled use (e.g. the tree in-node items) or
 * `defaultValue` for plain uncontrolled form submission.
 */
export function OwnerSelect({
  name,
  people,
  value,
  defaultValue,
  onChange,
  className,
  placeholder = "— unassigned —",
}: {
  name: string;
  people: PersonOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const sorted = [...people].sort((a, b) =>
    personLabel(a).localeCompare(personLabel(b)),
  );
  const current = value ?? defaultValue ?? "";
  const currentMissing =
    current !== "" && !sorted.some((p) => personLabel(p) === current);
  const controlled = value !== undefined;

  return (
    <select
      name={name}
      className={className}
      {...(controlled
        ? { value, onChange: (e) => onChange?.(e.target.value) }
        : { defaultValue })}
    >
      <option value="">{placeholder}</option>
      {currentMissing && (
        <option value={current}>{current} (not in roster)</option>
      )}
      {sorted.map((p) => (
        <option key={p.id} value={personLabel(p)}>
          {personLabel(p)}
        </option>
      ))}
    </select>
  );
}
