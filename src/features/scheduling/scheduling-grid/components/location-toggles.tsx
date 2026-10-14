"use client";

import type { ScheduleLocation } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";

/** The "LOCATIONS" chips that switch each clinic's columns on or off. */
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
      <span className="mr-1 text-xs font-bold uppercase tracking-wider text-slate-500">Locations</span>
      {availableLocations.map((loc) => {
        const on = enabled.has(loc.id);
        const color = loc.color ?? "#475569";
        return (
          <Button
            key={loc.id}
            size="sm"
            variant={on ? "default" : "outline"}
            aria-pressed={on}
            onClick={() => onToggle(loc.id)}
            className={`rounded-full px-3.5 ${on ? "border-transparent text-white shadow-sm hover:opacity-90" : "text-slate-700"}`}
            style={on ? { background: color } : undefined}
          >
            <span className="size-2 rounded-full" style={{ background: on ? "#fff" : color }} aria-hidden />
            {loc.name}
          </Button>
        );
      })}
    </div>
  );
}
