import { describe, expect, it } from "vitest";
import type { SchedDepartment } from "@/lib/schedule/types";
import { parseInput } from "@/lib/validation/form";
import { departmentSchema } from "@/features/scheduling/setup/schema/department.schema";
import { departmentFormDefaults } from "@/features/scheduling/setup/lib/department-form-defaults";

const dept: SchedDepartment = {
  id: "8f1d4c6a-2b3e-4f70-9a1b-5c6d7e8f9a0b",
  name: "Surgery",
  code: null,
  color: "#10b981",
  sort_order: 30,
  is_active: false,
  show_in_planning: true,
  created_at: "",
  updated_at: "",
};

describe("departmentFormDefaults", () => {
  it("starts a new department blank, active and not in planning", () => {
    expect(departmentFormDefaults()).toEqual({
      id: null,
      name: "",
      code: "",
      color: "#64748b",
      sort_order: "0",
      is_active: true,
      show_in_planning: false,
    });
  });

  it("copies the department being edited, with text for the inputs", () => {
    expect(departmentFormDefaults(dept)).toEqual({
      id: dept.id,
      name: "Surgery",
      code: "",
      color: "#10b981",
      sort_order: "30",
      is_active: false,
      show_in_planning: true,
    });
  });

  it("round-trips through the schema the action parses", () => {
    const parsed = parseInput(departmentSchema, departmentFormDefaults(dept));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data).toMatchObject({ id: dept.id, name: "Surgery", code: null, sort_order: 30, is_active: false });
    }
    // A blank new form is rejected on the name, as the old FormData path was.
    expect(parseInput(departmentSchema, departmentFormDefaults()).ok).toBe(false);
  });
});
