"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEmployeeField } from "./actions";

export type EditKind = "text" | "date" | "number" | "money" | "select" | "checkbox";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Inline-editable roster cell. Commits a single field to the same
 * person / person_employment tables the profile form writes to, so the grid
 * and the individual profile stay in sync. Read-only cells (disabled) simply
 * render the display text.
 */
export function EditableCell({
  personId,
  field,
  kind,
  rawValue,
  display,
  options,
  disabled = false,
  align = "left",
}: {
  personId: string;
  field: string;
  kind: EditKind;
  /** Current stored value (string | number | boolean | null). */
  rawValue: string | number | boolean | null | undefined;
  /** Pre-formatted display text (falls back to the raw value). */
  display?: string;
  /** Options for the select editor. */
  options?: SelectOption[];
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
    }
  }, [editing]);

  const shownText =
    display ??
    (rawValue === null || rawValue === undefined || rawValue === ""
      ? "—"
      : String(rawValue));

  function commit(next: string | boolean) {
    const current =
      kind === "checkbox" ? Boolean(rawValue) : rawValue ?? "";
    // Skip the write when nothing actually changed.
    if (kind === "checkbox" ? next === current : String(next) === String(current)) {
      setEditing(false);
      return;
    }
    const fd = new FormData();
    fd.set("value", typeof next === "boolean" ? (next ? "true" : "") : next);
    startTransition(async () => {
      const res = await updateEmployeeField(personId, field, fd);
      if (!res.ok) {
        window.alert(res.error);
      } else {
        router.refresh();
      }
      setEditing(false);
    });
  }

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // Read-only cell.
  if (disabled) {
    return <span className="text-slate-700">{shownText}</span>;
  }

  // Checkboxes are always interactive (no click-to-edit step).
  if (kind === "checkbox") {
    return (
      <span onClick={stop} className="inline-flex">
        <input
          type="checkbox"
          checked={Boolean(rawValue)}
          disabled={pending}
          onChange={(e) => commit(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          setEditing(true);
        }}
        className={`w-full truncate rounded px-1 py-0.5 text-left hover:bg-emerald-100/60 focus:bg-emerald-100 focus:outline-none ${
          align === "right" ? "text-right" : ""
        } ${shownText === "—" ? "text-slate-400" : "text-slate-700"}`}
        title="Click to edit"
      >
        {shownText}
      </button>
    );
  }

  const commonClass =
    "w-full rounded border border-emerald-400 bg-white px-1.5 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500";

  if (kind === "select") {
    return (
      <span onClick={stop}>
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          defaultValue={rawValue == null ? "" : String(rawValue)}
          disabled={pending}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setEditing(false)}
          className={commonClass}
        >
          <option value="">—</option>
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    );
  }

  const inputType =
    kind === "date" ? "date" : kind === "number" || kind === "money" ? "number" : "text";

  return (
    <span onClick={stop}>
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type={inputType}
        step={kind === "money" ? "0.01" : undefined}
        defaultValue={rawValue == null ? "" : String(rawValue)}
        disabled={pending}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        onBlur={(e) => commit(e.target.value)}
        className={`${commonClass} ${align === "right" ? "text-right" : ""}`}
      />
    </span>
  );
}
