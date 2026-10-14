import type { ColumnVisibilityState } from "@tanstack/react-table";
import type { ScheduleLocation } from "@/lib/schedule/types";
import { DAYS } from "@/features/scheduling/scheduling-grid/lib/grid-constants";

/** Column id of the (day, location) cell column. */
export function cellColumnId(day: number, locationId: string): string {
  return `${day}:${locationId}`;
}

/**
 * Which locations the grid opens with: the week's planned locations, or the
 * first available one when the week has none planned yet. MPMV is hidden
 * from the default view (still available to toggle on).
 */
export function defaultEnabledLocationIds(
  availableLocations: ScheduleLocation[],
  planLocationIds: Set<string>,
): Set<string> {
  const base = planLocationIds.size
    ? availableLocations.filter((l) => planLocationIds.has(l.id))
    : availableLocations.slice(0, 1);
  const init = base.filter((l) => (l.short_code ?? l.name).toUpperCase() !== "MPMV");
  return new Set(init.map((l) => l.id));
}

/**
 * The location toggles are the table's column visibility: a location is on
 * when its seven day columns are visible.
 */
export function columnVisibilityFor(
  availableLocations: ScheduleLocation[],
  enabledIds: Set<string>,
): ColumnVisibilityState {
  const visibility: ColumnVisibilityState = {};
  for (const loc of availableLocations) {
    for (const day of DAYS) visibility[cellColumnId(day, loc.id)] = enabledIds.has(loc.id);
  }
  return visibility;
}

/** Flip every day column of one location (a column absent from the state counts as visible). */
export function toggleLocationVisibility(
  visibility: ColumnVisibilityState,
  locationId: string,
): ColumnVisibilityState {
  const on = visibility[cellColumnId(0, locationId)] !== false;
  const next = { ...visibility };
  for (const day of DAYS) next[cellColumnId(day, locationId)] = !on;
  return next;
}

/** The locations currently shown, read back from the column visibility state. */
export function enabledLocationIds(
  visibility: ColumnVisibilityState,
  availableLocations: ScheduleLocation[],
): Set<string> {
  return new Set(
    availableLocations
      .filter((l) => visibility[cellColumnId(0, l.id)] !== false)
      .map((l) => l.id),
  );
}
