import { describe, expect, it } from "vitest";
import type { SchedShiftTemplate } from "@/lib/schedule/types";
import { shiftTemplateFormDefaults } from "@/features/scheduling/setup/lib/shift-template-form-defaults";

const line: SchedShiftTemplate = {
  id: "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d",
  department_id: "8f1d4c6a-2b3e-4f70-9a1b-5c6d7e8f9a0b",
  role_id: null,
  label: null,
  start_time: "08:00:00",
  end_time: "16:00:00",
  sort_order: 20,
  is_active: true,
};

describe("shiftTemplateFormDefaults", () => {
  it("starts a new line blank with order 0", () => {
    expect(shiftTemplateFormDefaults()).toEqual({
      id: null,
      department_id: "",
      role_id: "",
      new_role_name: "",
      label: "",
      start_time: "",
      end_time: "",
      sort_order: "0",
    });
  });

  it("copies the line being edited; null role / label become the blank choices", () => {
    expect(shiftTemplateFormDefaults(line)).toEqual({
      id: line.id,
      department_id: line.department_id,
      role_id: "",
      new_role_name: "",
      label: "",
      start_time: "08:00:00",
      end_time: "16:00:00",
      sort_order: "20",
    });
  });
});
