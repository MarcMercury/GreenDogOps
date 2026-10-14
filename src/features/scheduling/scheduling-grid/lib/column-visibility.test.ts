import { describe, expect, it } from "vitest";
import type { ScheduleLocation } from "@/lib/schedule/types";
import {
  cellColumnId,
  columnVisibilityFor,
  defaultEnabledLocationIds,
  enabledLocationIds,
  toggleLocationVisibility,
} from "@/features/scheduling/scheduling-grid/lib/column-visibility";

const loc = (id: string, short_code: string | null, name = id): ScheduleLocation =>
  ({ id, name, short_code, sort_order: 0, is_active: true, color: null }) as unknown as ScheduleLocation;

const SO = loc("so", "SO", "Sherman Oaks");
const VEN = loc("ven", "VEN", "Venice");
const MPMV = loc("mpmv", "MPMV", "MPMV");
const all = [SO, VEN, MPMV];

describe("defaultEnabledLocationIds", () => {
  it("opens with the week's planned locations, minus MPMV", () => {
    expect(defaultEnabledLocationIds(all, new Set(["so", "ven", "mpmv"]))).toEqual(new Set(["so", "ven"]));
  });

  it("falls back to the first available location when nothing is planned", () => {
    expect(defaultEnabledLocationIds(all, new Set())).toEqual(new Set(["so"]));
  });

  it("hides MPMV by name too, and can leave nothing enabled", () => {
    expect(defaultEnabledLocationIds([loc("m", null, "mpmv")], new Set())).toEqual(new Set());
  });
});

describe("column visibility ↔ enabled locations", () => {
  it("round-trips through the table's column visibility state", () => {
    const visibility = columnVisibilityFor(all, new Set(["ven"]));
    expect(visibility[cellColumnId(0, "ven")]).toBe(true);
    expect(visibility[cellColumnId(6, "so")]).toBe(false);
    expect(Object.keys(visibility)).toHaveLength(21);
    expect(enabledLocationIds(visibility, all)).toEqual(new Set(["ven"]));
  });

  it("toggles all seven columns of a location at once", () => {
    const off = toggleLocationVisibility(columnVisibilityFor(all, new Set(["so"])), "so");
    expect([0, 1, 2, 3, 4, 5, 6].every((d) => off[cellColumnId(d, "so")] === false)).toBe(true);
    const on = toggleLocationVisibility(off, "so");
    expect([0, 1, 2, 3, 4, 5, 6].every((d) => on[cellColumnId(d, "so")] === true)).toBe(true);
  });

  it("treats a column missing from the state as visible", () => {
    expect(enabledLocationIds({}, all)).toEqual(new Set(["so", "ven", "mpmv"]));
    expect(toggleLocationVisibility({}, "so")[cellColumnId(3, "so")]).toBe(false);
  });
});
