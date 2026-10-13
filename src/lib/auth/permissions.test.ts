import { describe, expect, it } from "vitest";
import {
  APP_ROLES,
  accessibleModules,
  canAccessModule,
  canEditModule,
  canOpenHrProfile,
  canViewAllCompensation,
  canViewSensitiveHr,
  hasRestrictedHrView,
  isCandidateStatus,
  MODULES,
  moduleForPathname,
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
// Known gap: ats_read still defaults Recruiting to on for Staff
// (docs/agent/improvements.md).
describe("module defaults mirrored in SQL", () => {
  it("keeps admin-only modules admin-only", () => {
    for (const key of ["admin", "reporting", "emp_reporting"] as const) {
      expect(canAccessModule(user("manager"), key)).toBe(false);
      expect(canAccessModule(user("staff"), key)).toBe(false);
      expect(canAccessModule(user("executive"), key)).toBe(true);
    }
    expect(canAccessModule(user("staff"), "email_templates")).toBe(false);
  });
  it("lets Staff read HR but not Recruiting, and edit nothing", () => {
    expect(canAccessModule(user("staff"), "hr")).toBe(true);
    expect(canAccessModule(user("staff"), "ats")).toBe(false);
    expect(canEditModule(user("staff"), "hr")).toBe(false);
    expect(canEditModule(user("staff"), "ats")).toBe(false);
  });
  it("honours per-user overrides", () => {
    expect(canAccessModule(user("staff", "me", { ats: true }), "ats")).toBe(true);
    expect(canAccessModule(user("schedule_admin", "me", { ats: false }), "ats")).toBe(false);
    expect(canAccessModule(user("manager", "me", { emp_reporting: true }), "emp_reporting")).toBe(true);
  });
  it("keeps Marketing Admins read-only on Operations modules", () => {
    expect(canEditModule(user("marketing_admin"), "schedule")).toBe(false);
    expect(canEditModule(user("marketing_admin"), "ats")).toBe(true);
    expect(canEditModule(user("schedule_admin"), "hr")).toBe(true);
  });
});

describe("Staff navigation", () => {
  // The owner's list: Dashboard, Resources, Ask Ziggy, HR / Roster (grid only),
  // Referral CRM, Rescue/Shelter CRM, Non-Med Partners, and all of Med Ops
  // (Medical Boards, Board Archive, Vendors & Supplies, ezyVet).
  // crm_business is the old /crm/business URL that redirects to Non-Med Partners.
  const STAFF = [
    "dashboard",
    "resources",
    "ask_ziggy",
    "hr",
    "crm_referral",
    "crm_rescue",
    "crm_vendor",
    "crm_business",
    "med_boards",
    "crm_supplies",
    "ezyvet",
  ];

  it("is exactly the approved module list", () => {
    expect([...accessibleModules(user("staff"))].sort()).toEqual([...STAFF].sort());
  });

  it("keeps every other module closed, including ones added later", () => {
    for (const m of MODULES.filter((d) => !STAFF.includes(d.key))) {
      expect(canAccessModule(user("staff"), m.key), m.key).toBe(false);
    }
  });

  it("blocks the Operations, Recruiting and Marketing routes", () => {
    for (const path of [
      "/ats",
      "/crm/student",
      "/crm/ce",
      "/crm/influencer",
      "/marketing",
      "/marketing/events",
      "/calendar",
      "/schedule",
      "/capacity",
      "/planning",
      "/schedule-search",
      "/email-templates",
    ]) {
      const key = moduleForPathname(path);
      expect(key, path).not.toBeNull();
      expect(canAccessModule(user("staff"), key!), path).toBe(false);
    }
  });

  it("leaves other roles' defaults unchanged", () => {
    for (const role of ["manager", "schedule_admin", "marketing_admin"] as const) {
      expect(canAccessModule(user(role), "ats"), role).toBe(true);
      expect(canAccessModule(user(role), "schedule"), role).toBe(true);
      expect(canAccessModule(user(role), "crm_student"), role).toBe(true);
    }
  });
});

describe("canOpenHrProfile", () => {
  it("lets Staff open only their own profile", () => {
    expect(canOpenHrProfile(user("staff"), "me")).toBe(true);
    expect(canOpenHrProfile(user("staff"), "someone-else")).toBe(false);
    expect(canOpenHrProfile(user("staff", null), "someone-else")).toBe(false);
  });
  it("lets every other HR viewer open any profile", () => {
    for (const role of APP_ROLES.filter((r) => r !== "staff")) {
      expect(canOpenHrProfile(user(role), "someone-else"), role).toBe(true);
    }
  });
  it("follows HR module access", () => {
    expect(canOpenHrProfile(user("manager", "me", { hr: false }), "someone-else")).toBe(false);
    expect(canOpenHrProfile(user("staff", "me", { hr: false }), "me")).toBe(false);
    expect(canOpenHrProfile({ ...user("staff"), is_active: false }, "me")).toBe(false);
  });
});

describe("Ask Ziggy", () => {
  it("is open to every active role by default, Staff included", () => {
    for (const role of APP_ROLES) {
      expect(canAccessModule(user(role), "ask_ziggy"), role).toBe(true);
    }
  });
  it("can be switched off per user and is closed to inactive users", () => {
    expect(canAccessModule(user("manager", "me", { ask_ziggy: false }), "ask_ziggy")).toBe(false);
    expect(canAccessModule({ ...user("owner"), is_active: false }, "ask_ziggy")).toBe(false);
  });
  it("gates /ask-ziggy on its own module, not on Reporting", () => {
    expect(moduleForPathname("/ask-ziggy")).toBe("ask_ziggy");
    expect(moduleForPathname("/ask-ziggy/anything")).toBe("ask_ziggy");
    // The old URL now belongs to Reporting (next.config redirects it first).
    expect(moduleForPathname("/reporting/smart")).toBe("reporting");
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
    expect(personDocumentAccess(user("staff"), "cand", "applicant")).toEqual({ read: false, edit: false });
    expect(personDocumentAccess(user("staff", "me", { ats: true }), "cand", "applicant")).toEqual({ read: true, edit: false });
    expect(personDocumentAccess(user("schedule_admin"), "cand", "applicant")).toEqual({ read: true, edit: true });
    expect(personDocumentAccess(user("schedule_admin", "me", { ats: false }), "cand", "applicant").read).toBe(false);
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

