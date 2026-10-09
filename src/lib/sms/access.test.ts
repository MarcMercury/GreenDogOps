import { describe, expect, it } from "vitest";
import type { AppRole, AppUser } from "../auth/permissions";
import { canTextPerson } from "./access";

function user(role: AppRole, moduleAccess: Record<string, boolean> = {}): AppUser {
  return {
    id: "u",
    email: "u@example.com",
    full_name: null,
    title: null,
    role,
    is_active: true,
    module_access: moduleAccess,
    notes: null,
    person_id: "me",
    last_seen_at: null,
    created_at: "",
    updated_at: "",
  };
}

describe("canTextPerson", () => {
  it("lets Recruiting editors text candidates", () => {
    expect(canTextPerson(user("manager"), "applicant")).toBe(true);
    expect(canTextPerson(user("owner"), "prospect")).toBe(true);
  });

  it("lets HR roles text employees and contractors", () => {
    for (const role of ["owner", "admin", "executive", "manager"] as AppRole[]) {
      expect(canTextPerson(user(role), "employee")).toBe(true);
      expect(canTextPerson(user(role), "contractor")).toBe(true);
    }
  });

  it("denies Staff everywhere, and Schedule/Marketing Admins for employees", () => {
    expect(canTextPerson(user("staff"), "applicant")).toBe(false);
    expect(canTextPerson(user("staff"), "employee")).toBe(false);
    expect(canTextPerson(user("schedule_admin"), "employee")).toBe(false);
    expect(canTextPerson(user("marketing_admin"), "employee")).toBe(false);
  });

  it("denies everyone for former employees and unknown statuses", () => {
    expect(canTextPerson(user("owner"), "former")).toBe(false);
    expect(canTextPerson(user("owner"), null)).toBe(false);
  });

  it("respects module access switched off for the user", () => {
    expect(canTextPerson(user("manager", { ats: false }), "applicant")).toBe(false);
    expect(canTextPerson(user("manager", { hr: false }), "employee")).toBe(false);
  });
});
