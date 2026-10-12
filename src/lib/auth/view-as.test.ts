import { describe, expect, it } from "vitest";
import type { AppUser } from "./permissions";
import { accessibleModules, canAccessModule, canEditModule } from "./permissions";
import {
  canUseViewAs,
  isPreviewGuardedRequest,
  parseViewAsTarget,
  PREVIEWABLE_ROLES,
  roleViewUser,
  safeReturnPath,
  serializeViewAsTarget,
} from "./view-as";

const UUID = "3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";

function user(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: UUID,
    email: "owner@example.com",
    full_name: "Owner",
    title: null,
    role: "owner",
    is_active: true,
    module_access: {},
    notes: null,
    person_id: "p-1",
    last_seen_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("canUseViewAs", () => {
  it("allows only active owners", () => {
    expect(canUseViewAs(user())).toBe(true);
    expect(canUseViewAs(user({ is_active: false }))).toBe(false);
    for (const role of PREVIEWABLE_ROLES) {
      expect(canUseViewAs(user({ role }))).toBe(false);
    }
  });
});

describe("parseViewAsTarget", () => {
  it("parses user and role targets", () => {
    expect(parseViewAsTarget(`user:${UUID}`)).toEqual({ kind: "user", userId: UUID });
    expect(parseViewAsTarget(`user:${UUID.toUpperCase()}`)).toEqual({ kind: "user", userId: UUID });
    expect(parseViewAsTarget("role:staff")).toEqual({ kind: "role", role: "staff" });
  });

  it("rejects malformed, unknown, and owner-role targets", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "self",
      UUID,
      "user:not-a-uuid",
      `user:${UUID}x`,
      "role:superuser",
      "role:owner",
      "group:staff",
    ]) {
      expect(parseViewAsTarget(bad)).toBeNull();
    }
  });

  it("round-trips through serializeViewAsTarget", () => {
    for (const value of [`user:${UUID}`, "role:marketing_admin"]) {
      const parsed = parseViewAsTarget(value);
      expect(parsed).not.toBeNull();
      expect(serializeViewAsTarget(parsed!)).toBe(value);
    }
  });
});

describe("roleViewUser", () => {
  it("applies the role's defaults and drops per-user overrides", () => {
    const owner = user({ module_access: { reporting: false } });
    const staff = roleViewUser(owner, "staff");
    expect(staff.role).toBe("staff");
    expect(staff.module_access).toEqual({});
    expect(staff.id).toBe(owner.id);
    expect(canAccessModule(staff, "admin")).toBe(false);
    expect(canEditModule(staff, "hr")).toBe(false);
    expect(accessibleModules(staff)).not.toContain("email_templates");
    // The original row is not mutated.
    expect(owner.role).toBe("owner");
    expect(owner.module_access).toEqual({ reporting: false });
  });
});

describe("isPreviewGuardedRequest", () => {
  it("lets page renders through", () => {
    expect(isPreviewGuardedRequest({ method: "GET", pathname: "/hr" })).toBe(false);
    expect(isPreviewGuardedRequest({ method: "head", pathname: "/" })).toBe(false);
  });

  it("guards server actions and API routes", () => {
    expect(isPreviewGuardedRequest({ method: "POST", pathname: "/hr" })).toBe(true);
    expect(isPreviewGuardedRequest({ method: "GET", pathname: "/api/ats/google/connect" })).toBe(true);
    expect(isPreviewGuardedRequest({ method: "DELETE", pathname: "/x" })).toBe(true);
  });

  it("fails closed when the proxy headers are missing", () => {
    expect(isPreviewGuardedRequest({ method: null, pathname: "/hr" })).toBe(true);
    expect(isPreviewGuardedRequest({ method: "GET", pathname: null })).toBe(false);
  });
});

describe("safeReturnPath", () => {
  it("keeps same-site paths", () => {
    expect(safeReturnPath("/hr/abc")).toBe("/hr/abc");
    expect(safeReturnPath("/")).toBe("/");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/ /evil.example",
      "hr",
    ]) {
      expect(safeReturnPath(bad)).toBe("/");
    }
  });
});
