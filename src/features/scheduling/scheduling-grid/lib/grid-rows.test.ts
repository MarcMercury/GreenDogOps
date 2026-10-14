import { describe, expect, it } from "vitest";
import type { SchedDepartment, SchedWeekLine } from "@/lib/schedule/types";
import { buildGridRows } from "@/features/scheduling/scheduling-grid/lib/grid-rows";

const dept = (id: string, sort_order: number, is_active = true): SchedDepartment => ({
  id,
  name: id.toUpperCase(),
  code: null,
  color: "#000",
  sort_order,
  is_active,
  show_in_planning: false,
  created_at: "",
  updated_at: "",
});

const line = (id: string, department_id: string, sort_order: number): SchedWeekLine => ({
  id,
  week_id: "w",
  template_id: null,
  department_id,
  role_id: null,
  label: null,
  start_time: null,
  end_time: null,
  sort_order,
  is_adhoc: false,
});

const departments = [dept("surg", 20), dept("ap", 10), dept("inactive", 30, false), dept("exotics", 40)];

describe("buildGridRows", () => {
  it("orders departments by sort_order and lines by sort_order within each", () => {
    const rows = buildGridRows({
      lines: [line("s2", "surg", 2), line("a1", "ap", 1), line("s1", "surg", 1)],
      departments,
      templateMode: false,
      agendaDeptIds: new Set(),
    });
    expect(rows.map((r) => r.id)).toEqual(["a1", "s1", "s2"]);
    expect(rows.every((r) => r.kind === "line")).toBe(true);
  });

  it("on a week, shows a department with booked appointments but no lines as an empty section", () => {
    const rows = buildGridRows({
      lines: [line("a1", "ap", 1)],
      departments,
      templateMode: false,
      agendaDeptIds: new Set(["exotics"]),
    });
    expect(rows.map((r) => [r.kind, r.departmentId])).toEqual([
      ["line", "ap"],
      ["empty", "exotics"],
    ]);
  });

  it("on the template, shows every active department, empty or not, and never an inactive one", () => {
    const rows = buildGridRows({
      lines: [line("s1", "surg", 1)],
      departments,
      templateMode: true,
      agendaDeptIds: new Set(),
    });
    expect(rows.map((r) => [r.kind, r.departmentId])).toEqual([
      ["empty", "ap"],
      ["line", "surg"],
      ["empty", "exotics"],
    ]);
  });

  it("drops lines whose department is not in setup", () => {
    const rows = buildGridRows({
      lines: [line("x", "ghost", 1)],
      departments,
      templateMode: false,
      agendaDeptIds: new Set(),
    });
    expect(rows).toEqual([]);
  });
});
