"use client";

import type { ScheduleLocation } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";

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
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Locations:
      </span>
      {availableLocations.map((loc) => {
        const on = enabled.has(loc.id);
        return (
          <Button
            key={loc.id}
            size="sm"
            variant={on ? "default" : "outline"}
            aria-pressed={on}
            onClick={() => onToggle(loc.id)}
            className={`rounded-full ${on ? "border-transparent text-white shadow-sm" : ""}`}
            style={on ? { background: loc.color ?? "#475569" } : undefined}
          >
            <span
              className="size-2 rounded-full"
              style={{ background: on ? "#fff" : loc.color ?? "#475569" }}
            />
            {loc.name}
          </Button>
        );
      })}
    </div>
  );
}
