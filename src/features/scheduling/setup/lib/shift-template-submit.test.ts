import { describe, expect, it } from "vitest";
import type { ShiftTemplateFormValues } from "@/features/scheduling/setup/schema/shift-template.schema";
import {
  NEW_ROLE_OPTION,
  isNewRole,
  toShiftTemplateInput,
} from "@/features/scheduling/setup/lib/shift-template-submit";

const base: ShiftTemplateFormValues = {
  id: null,
  department_id: "8f1d4c6a-2b3e-4f70-9a1b-5c6d7e8f9a0b",
  role_id: "",
  new_role_name: "",
  label: "Morning",
  start_time: "08:00",
  end_time: "16:00",
  sort_order: "10",
};

describe("toShiftTemplateInput", () => {
  it("sends the typed name with no role id when creating a role inline", () => {
    const out = toShiftTemplateInput({ ...base, role_id: NEW_ROLE_OPTION, new_role_name: "Clinic Tech" });
    expect(out.role_id).toBe("");
    expect(out.new_role_name).toBe("Clinic Tech");
    expect(isNewRole({ role_id: NEW_ROLE_OPTION })).toBe(true);
  });

  it("drops a stale typed name when an existing role (or any role) is chosen", () => {
    const roleId = "c3d0e40c-ac8f-4bea-bd4a-e50c6ddfee36";
    expect(toShiftTemplateInput({ ...base, role_id: roleId, new_role_name: "leftover" })).toEqual({
      ...base,
      role_id: roleId,
      new_role_name: "",
    });
    expect(toShiftTemplateInput({ ...base, new_role_name: "leftover" })).toEqual(base);
    expect(isNewRole({ role_id: roleId })).toBe(false);
  });

  it("leaves every other field untouched", () => {
    const out = toShiftTemplateInput({ ...base, role_id: NEW_ROLE_OPTION, new_role_name: "X" });
    expect(out).toMatchObject({ label: "Morning", start_time: "08:00", end_time: "16:00", sort_order: "10" });
  });
});
