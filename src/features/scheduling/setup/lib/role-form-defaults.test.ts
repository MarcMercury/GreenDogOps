import { describe, expect, it } from "vitest";
import { parseInput } from "@/lib/validation/form";
import { roleSchema } from "@/features/scheduling/setup/schema/role.schema";
import { roleFormDefaults } from "@/features/scheduling/setup/lib/role-form-defaults";

describe("roleFormDefaults", () => {
  it("starts blank with order 0", () => {
    expect(roleFormDefaults()).toEqual({ department_id: "", name: "", sort_order: "0" });
  });

  it("is rejected until a department and name are given, and then saves as an active role", () => {
    expect(parseInput(roleSchema, roleFormDefaults()).ok).toBe(false);
    const parsed = parseInput(roleSchema, {
      ...roleFormDefaults(),
      department_id: "8f1d4c6a-2b3e-4f70-9a1b-5c6d7e8f9a0b",
      name: "Surgery Tech",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data).toMatchObject({ id: null, sort_order: 0, is_active: true });
  });
});
