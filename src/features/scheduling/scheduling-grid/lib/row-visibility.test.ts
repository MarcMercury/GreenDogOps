import { describe, expect, it } from "vitest";
import type { SchedDepartment, SchedWeekLine } from "@/lib/schedule/types";
import {
  NOTHING_HIDDEN,
  PTO_ROW_ID,
  applyRowVisibility,
  departmentsForRowsCard,
  rowVisibilityCounts,
  toggled,
} from "@/features/scheduling/scheduling-grid/lib/row-visibility";
import type { GridRow } from "@/features/scheduling/scheduling-grid/types/grid-row";

const dept = (id: string): SchedDepartment => ({ id, name: id, color: "#000", sort_order: 0 }) as SchedDepartment;
const line = (id: string, department_id: string): SchedWeekLine => ({ id, department_id }) as SchedWeekLine;

const rows: GridRow[] = [
  { kind: "line", id: "a1", departmentId: "ap", line: line("a1", "ap") },
  { kind: "line", id: "a2", departmentId: "ap", line: line("a2", "ap") },
  { kind: "empty", id: "empty:im", departmentId: "im" },
];
const departmentById = new Map([dept("ap"), dept("im")].map((d) => [d.id, d]));

describe("row visibility", () => {
  it("hides whole departments and single lines", () => {
    expect(applyRowVisibility(rows, NOTHING_HIDDEN)).toHaveLength(3);
    expect(applyRowVisibility(rows, { departments: new Set(["ap"]), lines: new Set() }).map((r) => r.id)).toEqual(["empty:im"]);
    expect(applyRowVisibility(rows, { departments: new Set(), lines: new Set(["a2"]) }).map((r) => r.id)).toEqual(["a1", "empty:im"]);
  });

  it("counts the PTO section as one row when it is on the grid", () => {
    expect(rowVisibilityCounts(rows, NOTHING_HIDDEN, { withPto: true })).toEqual({ shown: 4, total: 4 });
    expect(rowVisibilityCounts(rows, { departments: new Set([PTO_ROW_ID, "ap"]), lines: new Set() }, { withPto: true })).toEqual({ shown: 1, total: 4 });
    expect(rowVisibilityCounts(rows, NOTHING_HIDDEN, { withPto: false })).toEqual({ shown: 3, total: 3 });
  });

  it("lists departments in grid order with their lines", () => {
    const list = departmentsForRowsCard(rows, departmentById);
    expect(list.map((d) => [d.dept.id, d.lines.map((l) => l.id)])).toEqual([
      ["ap", ["a1", "a2"]],
      ["im", []],
    ]);
  });

  it("toggles ids without mutating the input", () => {
    const base = new Set(["x"]);
    expect(toggled(base, "x").size).toBe(0);
    expect(toggled(base, "y")).toEqual(new Set(["x", "y"]));
    expect(base).toEqual(new Set(["x"]));
  });
});
