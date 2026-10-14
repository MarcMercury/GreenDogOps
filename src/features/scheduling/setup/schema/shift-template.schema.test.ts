import { describe, expect, it } from "vitest";
import { parseForm } from "@/lib/validation/form";
import { shiftTemplateSchema } from "./shift-template.schema";

const DEPT = "11111111-1111-4111-8111-111111111111";

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
