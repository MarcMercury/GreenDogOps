import { describe, expect, it } from "vitest";
import { aalFromAccessToken, mfaRequirement, roleRequiresMfa } from "./mfa-policy";

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

describe("roleRequiresMfa", () => {
  it("covers every role that can see compensation or administer the app", () => {
    expect(roleRequiresMfa("owner")).toBe(true);
    expect(roleRequiresMfa("admin")).toBe(true);
    expect(roleRequiresMfa("executive")).toBe(true);
    expect(roleRequiresMfa("manager")).toBe(true);
  });
  it("does not force it on other roles", () => {
    expect(roleRequiresMfa("schedule_admin")).toBe(false);
    expect(roleRequiresMfa("marketing_admin")).toBe(false);
    expect(roleRequiresMfa("staff")).toBe(false);
  });
});

describe("aalFromAccessToken", () => {
  it("reads the aal claim", () => {
    expect(aalFromAccessToken(jwt({ aal: "aal2" }))).toBe("aal2");
    expect(aalFromAccessToken(jwt({ aal: "aal1" }))).toBe("aal1");
  });
  it("returns null for missing or malformed tokens", () => {
    expect(aalFromAccessToken(undefined)).toBeNull();
    expect(aalFromAccessToken("garbage")).toBeNull();
    expect(aalFromAccessToken("a.!!!.c")).toBeNull();
    expect(aalFromAccessToken(jwt({ sub: "x" }))).toBeNull();
  });
});

describe("mfaRequirement", () => {
  const base = { hasVerifiedFactor: false, aal: "aal1", roleRequires: false, enforced: false };

  it("leaves users without a factor alone while enforcement is off (today's behaviour)", () => {
    expect(mfaRequirement({ ...base, roleRequires: true })).toBe("ok");
    expect(mfaRequirement(base)).toBe("ok");
  });

  it("asks enrolled users for a code until the session is aal2", () => {
    expect(mfaRequirement({ ...base, hasVerifiedFactor: true })).toBe("challenge");
    expect(mfaRequirement({ ...base, hasVerifiedFactor: true, aal: null })).toBe("challenge");
    expect(mfaRequirement({ ...base, hasVerifiedFactor: true, aal: "aal2" })).toBe("ok");
  });

  it("requires enrollment only for required roles when enforced", () => {
    expect(mfaRequirement({ ...base, roleRequires: true, enforced: true })).toBe("enroll");
    expect(mfaRequirement({ ...base, roleRequires: false, enforced: true })).toBe("ok");
  });
});
