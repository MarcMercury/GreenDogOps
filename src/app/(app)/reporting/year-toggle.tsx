"use client";

import { useRouter } from "next/navigation";

export function YearToggle({
  years,
  selected,
}: {
  years: number[];
  selected: number;
}) {
  const router = useRouter();

  // Nothing to toggle when only one year of data exists, but keep the chip
  // visible so it's clear which year is being shown.
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
      <span className="px-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        Year
      </span>
      {years.map((y) => {
        const active = y === selected;
        return (
          <button
            key={y}
            type="button"
            onClick={() => router.push(`/reporting?year=${y}`)}
            aria-pressed={active}
            className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
              active
                ? "bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {y}
          </button>
        );
      })}
    </div>
  );
}
