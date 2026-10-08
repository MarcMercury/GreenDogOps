import { describe, expect, it } from "vitest";
import {
  APP_ROLES,
  canAccessModule,
  canEditModule,
  canViewAllCompensation,
  canViewSensitiveHr,
  hasRestrictedHrView,
  isCandidateStatus,
  personDocumentAccess,
  seesPrivateHrFields,
  type AppRole,
  type AppUser,
} from "./permissions";

function user(role: AppRole, personId: string | null = "me", moduleAccess: Record<string, boolean> = {}): AppUser {
  return {
    id: "u",
    email: "u@example.com",
    full_name: null,
    title: null,
    role,
    is_active: true,
    module_access: moduleAccess,
    notes: null,
    person_id: personId,
    last_seen_at: null,
    created_at: "",
    updated_at: "",
  };
}

const HR_FULL: AppRole[] = ["owner", "admin", "executive", "manager"];

describe("sensitive HR access (mirrors the hr_full RLS predicate)", () => {
  it("is exactly the compensation roles", () => {
    for (const role of APP_ROLES) {
      expect(canViewSensitiveHr(role)).toBe(HR_FULL.includes(role));
      expect(canViewSensitiveHr(role)).toBe(canViewAllCompensation(role));
    }
  });
});

describe("hasRestrictedHrView", () => {
  it("never restricts HR roles", () => {
    for (const role of HR_FULL) {
      expect(hasRestrictedHrView(user(role), "someone-else")).toBe(false);
    }
  });
  it("keeps Schedule/Marketing Admins on the restricted view (unchanged)", () => {
    expect(hasRestrictedHrView(user("schedule_admin"), "someone-else")).toBe(true);
    expect(hasRestrictedHrView(user("marketing_admin"), "me")).toBe(true);
  });
  it("restricts Staff on other people but not on their own record", () => {
    expect(hasRestrictedHrView(user("staff"), "someone-else")).toBe(true);
    expect(hasRestrictedHrView(user("staff"), "me")).toBe(false);
    expect(hasRestrictedHrView(user("staff", null), "me")).toBe(true);
  });
});

describe("seesPrivateHrFields", () => {
  it("hides personal fields only from Staff viewing someone else", () => {
    expect(seesPrivateHrFields(user("staff"), "someone-else")).toBe(false);
    expect(seesPrivateHrFields(user("staff"), "me")).toBe(true);
    for (const role of APP_ROLES.filter((r) => r !== "staff")) {
      expect(seesPrivateHrFields(user(role), "someone-else")).toBe(true);
    }
  });
});

// The RLS predicates in migration 0227 (hr_edit / ats_read / ats_edit)
// copy these defaults; this pins them so a change here is noticed there.
describe("module defaults mirrored in SQL", () => {
  it("keeps admin-only modules admin-only", () => {
    for (const key of ["admin", "reporting", "emp_reporting"] as const) {
      expect(canAccessModule(user("manager"), key)).toBe(false);
      expect(canAccessModule(user("staff"), key)).toBe(false);
      expect(canAccessModule(user("executive"), key)).toBe(true);
    }
    expect(canAccessModule(user("staff"), "email_templates")).toBe(false);
  });
  it("lets Staff read HR and Recruiting but edit nothing", () => {
    expect(canAccessModule(user("staff"), "hr")).toBe(true);
    expect(canAccessModule(user("staff"), "ats")).toBe(true);
    expect(canEditModule(user("staff"), "hr")).toBe(false);
    expect(canEditModule(user("staff"), "ats")).toBe(false);
  });
  it("honours per-user overrides", () => {
    expect(canAccessModule(user("staff", "me", { ats: false }), "ats")).toBe(false);
    expect(canAccessModule(user("manager", "me", { emp_reporting: true }), "emp_reporting")).toBe(true);
  });
  it("keeps Marketing Admins read-only on Operations modules", () => {
    expect(canEditModule(user("marketing_admin"), "schedule")).toBe(false);
    expect(canEditModule(user("marketing_admin"), "ats")).toBe(true);
    expect(canEditModule(user("schedule_admin"), "hr")).toBe(true);
  });
});

// Mirrors the person_document RLS policies; used by service-role code paths
// (ATS document actions) that RLS cannot see.
describe("personDocumentAccess", () => {
  it("treats only prospects and applicants as candidates", () => {
    expect(isCandidateStatus("prospect")).toBe(true);
    expect(isCandidateStatus("applicant")).toBe(true);
    for (const s of ["employee", "former", "contractor", null, undefined]) {
      expect(isCandidateStatus(s)).toBe(false);
    }
  });

  it("blocks Staff from another employee's HR documents (regression: ATS getCandidateDocuments)", () => {
    expect(personDocumentAccess(user("staff"), "someone-else", "employee")).toEqual({ read: false, edit: false });
  });

  it("lets Recruiting users see candidates' documents; only editors change them", () => {
    expect(personDocumentAccess(user("staff"), "cand", "applicant")).toEqual({ read: true, edit: false });
    expect(personDocumentAccess(user("schedule_admin"), "cand", "applicant")).toEqual({ read: true, edit: true });
    expect(personDocumentAccess(user("staff", "me", { ats: false }), "cand", "applicant").read).toBe(false);
  });

  it("keeps employee shelves to HR roles (and the employee, read-only)", () => {
    expect(personDocumentAccess(user("schedule_admin"), "emp", "employee")).toEqual({ read: false, edit: false });
    expect(personDocumentAccess(user("manager"), "emp", "former")).toEqual({ read: true, edit: true });
    expect(personDocumentAccess(user("manager", "me", { hr: false }), "emp", "employee")).toEqual({ read: true, edit: false });
    expect(personDocumentAccess(user("staff"), "me", "employee")).toEqual({ read: true, edit: false });
  });

  it("denies inactive users", () => {
    const inactive = { ...user("owner"), is_active: false };
    expect(personDocumentAccess(inactive, "cand", "applicant")).toEqual({ read: false, edit: false });
  });
});

