"use client";

import type { ScheduleLocation } from "@/lib/schedule/types";

/** The "Locations:" chips that switch each clinic's columns on or off. */
export function LocationToggles({
  availableLocations,
  enabled,
  onToggle,
}: {
  availableLocations: ScheduleLocation[];
  enabled: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Locations:
      </span>
      {availableLocations.map((loc) => {
        const on = enabled.has(loc.id);
        return (
          <button
            key={loc.id}
            onClick={() => onToggle(loc.id)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
              on
                ? "border-transparent text-white shadow-sm"
                : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
            }`}
            style={on ? { background: loc.color ?? "#475569" } : undefined}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: on ? "#fff" : loc.color ?? "#475569" }}
            />
            {loc.name}
          </button>
        );
      })}
    </div>
  );
}
