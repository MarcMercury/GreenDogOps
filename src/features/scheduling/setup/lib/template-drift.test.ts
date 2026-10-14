import { describe, expect, it } from "vitest";
import type {
  SchedDepartment,
  SchedShiftTemplate,
  SchedWeekLine,
} from "@/lib/schedule/types";
import { templateDrift } from "./template-drift";

const dept = (id: string, is_active = true): SchedDepartment => ({
  id,
  name: id,
  code: null,
  color: "#000000",
  sort_order: 0,
  is_active,
  show_in_planning: false,
  created_at: "",
  updated_at: "",
});

const template = (
  id: string,
  department_id: string,
  extra: Partial<SchedShiftTemplate> = {},
): SchedShiftTemplate => ({
  id,
  department_id,
  role_id: null,
  label: null,
  start_time: "08:00:00",
  end_time: "17:00:00",
  sort_order: 0,
  is_active: true,
  ...extra,
});

const line = (
  id: string,
  template_id: string | null,
  department_id: string,
  extra: Partial<SchedWeekLine> = {},
): SchedWeekLine => ({
  id,
  week_id: "w",
  template_id,
  department_id,
  role_id: null,
  label: null,
  start_time: "08:00:00",
  end_time: "17:00:00",
  sort_order: 0,
  is_adhoc: false,
  ...extra,
});

describe("templateDrift", () => {
  it("reports no drift when every active template has one matching line", () => {
    const data = {
      departments: [dept("d1")],
      templates: [template("t1", "d1")],
    };
    expect(templateDrift(data, [line("l1", "t1", "d1")])).toEqual({
      added: 0,
      updated: 0,
      removed: 0,
      total: 0,
    });
  });

  it("counts a template with no line as added", () => {
    const data = {
      departments: [dept("d1")],
      templates: [template("t1", "d1"), template("t2", "d1")],
    };
    expect(templateDrift(data, [line("l1", "t1", "d1")])).toMatchObject({
      added: 1,
      total: 1,
    });
  });

  it("counts a line whose times or order differ from its template as updated", () => {
    const data = {
      departments: [dept("d1")],
      templates: [template("t1", "d1", { start_time: "09:00:00" })],
    };
    expect(templateDrift(data, [line("l1", "t1", "d1")])).toMatchObject({
      updated: 1,
      total: 1,
    });
  });

  it("counts surplus, ad-hoc and orphaned lines as removed", () => {
    const data = {
      departments: [dept("d1"), dept("d2", false)],
      templates: [template("t1", "d1"), template("t2", "d2")],
    };
    const lines = [
      line("l1", "t1", "d1"),
      line("l2", "t1", "d1"), // duplicate line for the same template
      line("l3", null, "d1", { is_adhoc: true }), // added straight onto the grid
      line("l4", "t2", "d2"), // template in an inactive department
    ];
    expect(templateDrift(data, lines)).toEqual({
      added: 0,
      updated: 0,
      removed: 3,
      total: 3,
    });
  });

  it("treats null and undefined role / label as equal", () => {
    const data = {
      departments: [dept("d1")],
      templates: [template("t1", "d1", { role_id: null, label: null })],
    };
    const l = line("l1", "t1", "d1");
    (l as { role_id?: string | null }).role_id = undefined;
    expect(templateDrift(data, [l]).updated).toBe(0);
  });
});
