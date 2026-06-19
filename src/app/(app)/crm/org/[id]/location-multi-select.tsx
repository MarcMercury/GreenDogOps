"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface LocationOption {
  value: string;
  label: string;
}

/**
 * Multi-select dropdown for choosing which clinic locations a CRM
 * organization serves. Selected values are submitted as repeated hidden
 * inputs sharing `name`, so the server action can read them with
 * `formData.getAll(name)`.
 */
export function LocationMultiSelect({
  label,
  name,
  locations,
  defaultValue,
}: {
  label: string;
  name: string;
  locations: LocationOption[];
  defaultValue?: string | null;
}) {
  // Parse the stored comma-separated value into individual entries.
  const initial = useMemo(
    () =>
      (defaultValue ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [defaultValue],
  );

  // Merge any stored values that are not part of the known location list so
  // legacy/free-text data ("All", etc.) is preserved and still selectable.
  const options = useMemo(() => {
    const known = new Set(locations.map((l) => l.value.toLowerCase()));
    const extras = initial
      .filter((v) => !known.has(v.toLowerCase()))
      .map((v) => ({ value: v, label: v }));
    return [...locations, ...extras];
  }, [locations, initial]);

  const [selected, setSelected] = useState<string[]>(initial);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function toggle(value: string) {
    setSelected((prev) =>
      prev.includes(value)
        ? prev.filter((v) => v !== value)
        : [...prev, value],
    );
  }

  const labelFor = (value: string) =>
    options.find((o) => o.value === value)?.label ?? value;

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>

      {/* Submit each selected value as a hidden input. */}
      {selected.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}

      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-[2.5rem] w-full flex-wrap items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-left text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          {selected.length === 0 ? (
            <span className="text-slate-400">Select clinics…</span>
          ) : (
            selected.map((value) => (
              <span
                key={value}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
              >
                {labelFor(value)}
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(value);
                  }}
                  className="cursor-pointer text-emerald-500 hover:text-emerald-800"
                  aria-label={`Remove ${labelFor(value)}`}
                >
                  ×
                </span>
              </span>
            ))
          )}
          <span className="ml-auto pl-1 text-slate-400">▾</span>
        </button>

        {open && (
          <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">
                No locations configured.
              </p>
            ) : (
              options.map((opt) => {
                const checked = selected.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(opt.value)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    {opt.label}
                  </label>
                );
              })
            )}
          </div>
        )}
      </div>
    </label>
  );
}
