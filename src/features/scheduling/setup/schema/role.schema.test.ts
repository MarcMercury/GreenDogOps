import { describe, expect, it } from "vitest";
import { parseForm } from "@/lib/validation/form";
import { roleSchema } from "@/features/scheduling/setup/schema/role.schema";
import { departmentSchema } from "@/features/scheduling/setup/schema/department.schema";

const DEPT = "8f1d4c6a-2b3e-4f70-9a1b-5c6d7e8f9a0b";

function roleForm(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("department_id", DEPT);
  fd.set("name", "Surgery Tech");
  fd.set("sort_order", "0");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

describe("roleSchema", () => {
  // The Add-role form (Set Up ▸ Roles & Eligibility) never renders an "Active"
  // box. From de633bb (2026-09-29) to 2026-10-13 the plain `checkbox` helper
  // turned that missing field into `false`, so every role added there was
  // inserted inactive and dropped out of the HR profile's eligibility list.
  it("treats a missing is_active as active (the Add-role form has no box)", () => {
    const parsed = parseForm(roleSchema, roleForm());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.is_active).toBe(true);
  });

  it("keeps an explicit on / off value", () => {
    const on = parseForm(roleSchema, roleForm({ is_active: "on" }));
    const off = parseForm(roleSchema, roleForm({ is_active: "false" }));
    expect(on.ok && on.data.is_active).toBe(true);
    expect(off.ok && off.data.is_active).toBe(false);
  });

  it("still requires a department and a name", () => {
    const fd = roleForm();
    fd.delete("department_id");
    expect(parseForm(roleSchema, fd).ok).toBe(false);
    const blank = roleForm({ name: "   " });
    expect(parseForm(roleSchema, blank).ok).toBe(false);
  });
});

describe("departmentSchema", () => {
  // Both department forms render the Active box, so here an absent field is an
  // unchecked box and must stay `false` — the opposite default from roles.
  it("treats a missing is_active as unchecked", () => {
    const fd = new FormData();
    fd.set("name", "Surgery");
    const parsed = parseForm(departmentSchema, fd);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.is_active).toBe(false);
      expect(parsed.data.show_in_planning).toBe(false);
      expect(parsed.data.color).toBe("#64748b");
    }
  });
});
