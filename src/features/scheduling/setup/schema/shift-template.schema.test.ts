import { describe, expect, it } from "vitest";
import { parseForm, parseInput } from "@/lib/validation/form";
import { NEW_ROLE_OPTION } from "@/features/scheduling/setup/lib/shift-template-submit";
import {
  shiftTemplateFormSchema,
  shiftTemplateSchema,
  type ShiftTemplateFormValues,
} from "./shift-template.schema";

const DEPT = "11111111-1111-4111-8111-111111111111";
const ROLE = "22222222-2222-4222-8222-222222222222";

const formValues: ShiftTemplateFormValues = {
  id: null,
  department_id: DEPT,
  role_id: "",
  new_role_name: "",
  label: "",
  start_time: "08:00",
  end_time: "16:00",
  sort_order: "0",
};

describe("shiftTemplateFormSchema (the form's client-side validator)", () => {
  it("requires a name when “+ New role…” is chosen, on the new_role_name field", () => {
    const res = shiftTemplateFormSchema.safeParse({ ...formValues, role_id: NEW_ROLE_OPTION });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.map((i) => [i.path.join("."), i.message])).toEqual([
        ["new_role_name", "Give the new role a name."],
      ]);
    }
  });

  it("maps “+ New role…” to a blank role id with the typed name, as the action expects", () => {
    const res = shiftTemplateFormSchema.safeParse({
      ...formValues,
      role_id: NEW_ROLE_OPTION,
      new_role_name: " Clinic Tech ",
    });
    expect(res.success && res.data).toMatchObject({ role_id: null, new_role_name: "Clinic Tech", is_active: true });
  });

  it("drops a stale typed name when an existing role is chosen, and still applies the base rules", () => {
    const res = shiftTemplateFormSchema.safeParse({ ...formValues, role_id: ROLE, new_role_name: "stale" });
    expect(res.success && res.data).toMatchObject({ role_id: ROLE, new_role_name: null });
    expect(shiftTemplateFormSchema.safeParse({ ...formValues, department_id: "" }).success).toBe(false);
    expect(parseInput(shiftTemplateSchema, { ...formValues, role_id: ROLE }).ok).toBe(true);
  });
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("shiftTemplateSchema", () => {
  it("keeps a template active when the form sends no is_active field", () => {
    const parsed = parseForm(
      shiftTemplateSchema,
      form({ department_id: DEPT, role_id: "", start_time: "08:00", sort_order: "" }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data).toMatchObject({
      department_id: DEPT,
      role_id: null,
      new_role_name: null,
      label: null,
      start_time: "08:00",
      end_time: null,
      sort_order: 0,
      is_active: true,
    });
  });

  it("only turns a template off when is_active is explicitly unchecked", () => {
    const off = parseForm(shiftTemplateSchema, form({ department_id: DEPT, is_active: "false" }));
    expect(off.ok && off.data.is_active).toBe(false);
    const on = parseForm(shiftTemplateSchema, form({ department_id: DEPT, is_active: "on" }));
    expect(on.ok && on.data.is_active).toBe(true);
  });

  it("passes a typed new role name through for find-or-create", () => {
    const parsed = parseForm(
      shiftTemplateSchema,
      form({ department_id: DEPT, role_id: "", new_role_name: " Clinic Tech " }),
    );
    expect(parsed.ok && parsed.data.new_role_name).toBe("Clinic Tech");
  });

  it("rejects a line with no department", () => {
    expect(parseForm(shiftTemplateSchema, form({ department_id: "" })).ok).toBe(false);
  });
});
