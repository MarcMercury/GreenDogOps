import { describe, expect, it } from "vitest";
import { APP_ROLES, type AppRole } from "../auth/permissions";
import {
  canManageDocuments,
  canViewDocument,
  isDocumentRecipient,
  clinicToday,
  describeAccess,
  documentAudience,
  normalizeInitials,
  normalizeVisibleRoles,
  signatureState,
} from "./access";

const u = (role: AppRole, id = `u-${role}`, is_active = true) => ({ id, role, is_active });
const none = new Set<string>();
const MANAGERS: AppRole[] = ["owner", "admin", "executive", "manager"];

describe("canManageDocuments", () => {
  it("is HR / Manager and above only", () => {
    for (const role of APP_ROLES) {
      expect(canManageDocuments(u(role))).toBe(MANAGERS.includes(role));
    }
  });
  it("is never true for an inactive user", () => {
    expect(canManageDocuments(u("owner", "x", false))).toBe(false);
  });
});

describe("canViewDocument (mirrors the 0235 RLS policy)", () => {
  it("everyone sees a document with no role list", () => {
    for (const role of APP_ROLES) {
      expect(canViewDocument(u(role), { visible_roles: null }, none)).toBe(true);
    }
  });

  it("a role list admits those roles plus managers, nobody else", () => {
    const doc = { visible_roles: ["staff"] };
    for (const role of APP_ROLES) {
      expect(canViewDocument(u(role), doc, none)).toBe(role === "staff" || MANAGERS.includes(role));
    }
  });

  it("named people see a document their role cannot", () => {
    const doc = { visible_roles: [] as string[] };
    expect(canViewDocument(u("schedule_admin", "sa1"), doc, none)).toBe(false);
    expect(canViewDocument(u("schedule_admin", "sa1"), doc, new Set(["sa1"]))).toBe(true);
    expect(canViewDocument(u("staff", "s2"), doc, new Set(["sa1"]))).toBe(false);
  });

  it("denies inactive users even on public documents", () => {
    expect(canViewDocument(u("staff", "x", false), { visible_roles: null }, none)).toBe(false);
  });
});

describe("isDocumentRecipient / documentAudience (who is notified and asked to sign)", () => {
  it("is everyone for an everyone document, managers included", () => {
    for (const role of APP_ROLES) expect(isDocumentRecipient(u(role), { visible_roles: null }, none)).toBe(true);
  });

  it("leaves managers out of a document addressed to someone else", () => {
    const users = [u("staff", "s1"), u("staff", "s2", false), u("marketing_admin", "m1"), u("manager", "h1"), u("owner", "o1")];
    const ids = documentAudience({ visible_roles: [] }, users, new Set(["s1", "s2"])).map((x) => x.id);
    expect(ids).toEqual(["s1"]);
    // ...though they can still open it to manage it.
    expect(canViewDocument(u("manager", "h1"), { visible_roles: [] }, new Set(["s1"]))).toBe(true);
  });

  it("includes managers when their role or name is chosen", () => {
    expect(isDocumentRecipient(u("manager", "h1"), { visible_roles: ["manager"] }, none)).toBe(true);
    expect(isDocumentRecipient(u("executive", "e1"), { visible_roles: ["staff"] }, new Set(["e1"]))).toBe(true);
    expect(isDocumentRecipient(u("executive", "e1"), { visible_roles: ["staff"] }, none)).toBe(false);
  });
});

describe("normalizeVisibleRoles", () => {
  it("drops unknown roles and keeps canonical order", () => {
    expect(normalizeVisibleRoles(["staff", "bogus", "admin"])).toEqual(["admin", "staff"]);
    expect(normalizeVisibleRoles(null)).toBeNull();
    expect(normalizeVisibleRoles([])).toEqual([]);
  });
});

describe("signatureState", () => {
  const doc = { require_signature: true, signature_from_version: 3, current_version: 4 };
  it("is not required when the document does not ask for one", () => {
    expect(signatureState({ ...doc, require_signature: false }, [])).toBe("not_required");
  });
  it("counts a signature on the baseline version or later", () => {
    expect(signatureState(doc, [3])).toBe("signed");
    expect(signatureState(doc, [4])).toBe("signed");
  });
  it("is pending when the only signature predates a re-sign request", () => {
    expect(signatureState(doc, [1, 2])).toBe("pending");
    expect(signatureState(doc, [])).toBe("pending");
  });
});

describe("normalizeInitials", () => {
  it("accepts letters with common punctuation and upper-cases them", () => {
    expect(normalizeInitials(" mh ")).toBe("MH");
    expect(normalizeInitials("j.r.")).toBe("J.R.");
    expect(normalizeInitials("A-B")).toBe("A-B");
  });
  it("rejects blanks, digits, markup and overlong input", () => {
    for (const bad of ["", "  ", "12", "<b>", "abcdefghijk", ".mh"]) {
      expect(normalizeInitials(bad)).toBeNull();
    }
  });
  it("agrees with the database check constraint", () => {
    const db = /^[A-Za-z][A-Za-z.'\- ]{0,9}$/;
    for (const v of ["MH", "J.R.", "O'B", "ab cd"]) expect(db.test(normalizeInitials(v)!)).toBe(true);
  });
});

describe("clinicToday", () => {
  it("uses Los Angeles time, not UTC", () => {
    // 2026-10-13 03:00 UTC is still the 12th in California.
    expect(clinicToday(new Date("2026-10-13T03:00:00Z"))).toBe("2026-10-12");
  });
});

describe("describeAccess", () => {
  it("summarises the access settings", () => {
    expect(describeAccess(null, 0)).toBe("Everyone");
    expect(describeAccess(["staff", "manager"], 0)).toBe("HR / Manager, Staff");
    expect(describeAccess(["staff"], 2)).toBe("Staff + 2 people");
    expect(describeAccess([], 1)).toBe("Only 1 person");
    expect(describeAccess([], 0)).toBe("Nobody yet (HR / Managers can still open it)");
  });
});
