import { describe, expect, it } from "vitest";
import type { SchedWeekLine } from "@/lib/schedule/types";
import {
  NEW_ROLE_OPTION,
  weekLineFormSchema,
} from "@/features/scheduling/scheduling-grid/schema/week-line.schema";
import {
  toWeekLineInput,
  weekLineFormDefaults,
} from "@/features/scheduling/scheduling-grid/lib/week-line-form";

const UUID = "11111111-2222-4333-8444-555555555555";

const line: SchedWeekLine = {
  id: "l1",
  week_id: "w1",
  template_id: null,
  department_id: UUID,
  role_id: null,
  label: "Float",
  start_time: "08:00:00",
  end_time: "16:00:00",
  sort_order: 20,
  is_adhoc: true,
};

describe("weekLineFormDefaults", () => {
  it("fills from the line being edited, with a blank role meaning 'any'", () => {
    expect(weekLineFormDefaults(line)).toEqual({
      department_id: UUID,
      role_id: "",
      new_role_name: "",
      label: "Float",
      start_time: "08:00:00",
      end_time: "16:00:00",
      sort_order: "20",
    });
  });

  it("starts a new line in the department it was opened from, at the end of the order", () => {
    const v = weekLineFormDefaults(null, UUID);
    expect(v.department_id).toBe(UUID);
    expect(v.sort_order).toBe("9999");
  });
});

describe("toWeekLineInput", () => {
  it("sends no role id but keeps the typed name for '+ New role…'", () => {
    const v = { ...weekLineFormDefaults(null, UUID), role_id: NEW_ROLE_OPTION, new_role_name: "Surgery Tech" };
    expect(toWeekLineInput(v)).toMatchObject({ role_id: "", new_role_name: "Surgery Tech" });
  });

  it("keeps an existing role id and drops a stray name", () => {
    const v = { ...weekLineFormDefaults(null, UUID), role_id: UUID, new_role_name: "ignored" };
    expect(toWeekLineInput(v)).toMatchObject({ role_id: UUID, new_role_name: "" });
  });
});

describe("weekLineFormSchema", () => {
  it("requires a name when '+ New role…' is chosen, and end after start", () => {
    const base = weekLineFormDefaults(null, UUID);
    expect(weekLineFormSchema.safeParse({ ...base, role_id: NEW_ROLE_OPTION }).success).toBe(false);
    expect(weekLineFormSchema.safeParse({ ...base, role_id: NEW_ROLE_OPTION, new_role_name: "Tech" }).success).toBe(true);
    expect(weekLineFormSchema.safeParse({ ...base, start_time: "16:00", end_time: "08:00" }).success).toBe(false);
    expect(weekLineFormSchema.safeParse(base).success).toBe(true);
  });
});
