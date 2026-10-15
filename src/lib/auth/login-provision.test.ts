import { describe, expect, it } from "vitest";
import {
  AUTO_LOGIN_ROLE,
  eligibleForAutoLogin,
  findExistingLogin,
  peopleMissingLogins,
  type ExistingLogin,
  type LoginCandidate,
} from "./login-provision";

const person = (over: Partial<LoginCandidate> = {}): LoginCandidate => ({
  id: "p1",
  status: "employee",
  is_active: true,
  email: "New.Hire@Example.com ",
  ...over,
});

describe("eligibleForAutoLogin", () => {
  it("gives an active employee with an email a login", () => {
    expect(eligibleForAutoLogin(person())).toBe(true);
  });

  it("covers contractors like the 2026-10-13 bulk provisioning", () => {
    expect(eligibleForAutoLogin(person({ status: "contractor" }))).toBe(true);
  });

  it.each(["applicant", "prospect", "former"])("skips status %s", (status) => {
    expect(eligibleForAutoLogin(person({ status }))).toBe(false);
  });

  it("skips inactive people and people without an email", () => {
    expect(eligibleForAutoLogin(person({ is_active: false }))).toBe(false);
    expect(eligibleForAutoLogin(person({ email: null }))).toBe(false);
    expect(eligibleForAutoLogin(person({ email: "   " }))).toBe(false);
  });

  it("provisions as staff, never an admin role", () => {
    expect(AUTO_LOGIN_ROLE).toBe("staff");
  });
});

describe("findExistingLogin", () => {
  const logins: ExistingLogin[] = [
    { id: "auth-a", email: "a@example.com", person_id: "pa" },
    { id: "auth-b", email: "B@Example.com", person_id: null },
  ];

  it("matches by auth id, person link, or case-insensitive email", () => {
    expect(findExistingLogin(logins, { authId: "auth-a", personId: "x", email: null })?.id).toBe("auth-a");
    expect(findExistingLogin(logins, { authId: null, personId: "pa", email: null })?.id).toBe("auth-a");
    expect(findExistingLogin(logins, { authId: null, personId: "x", email: " b@example.COM" })?.id).toBe("auth-b");
  });

  it("returns null when nothing covers the person", () => {
    expect(findExistingLogin(logins, { authId: "auth-z", personId: "pz", email: "z@example.com" })).toBeNull();
  });
});

describe("peopleMissingLogins", () => {
  it("returns only eligible people with no login by person or email", () => {
    const people = [
      person({ id: "has-link", email: "x@example.com" }),
      person({ id: "has-email", email: "B@example.com" }),
      person({ id: "former", status: "former", email: "f@example.com" }),
      person({ id: "missing", email: "new@example.com" }),
    ];
    const logins: ExistingLogin[] = [
      { id: "1", email: "other@example.com", person_id: "has-link" },
      { id: "2", email: "b@example.com", person_id: null },
    ];
    expect(peopleMissingLogins(people, logins).map((p) => p.id)).toEqual(["missing"]);
  });

  it("skips roster people who share an email", () => {
    const people = [
      person({ id: "a", email: "shared@example.com" }),
      person({ id: "b", email: "Shared@example.com" }),
    ];
    expect(peopleMissingLogins(people, [])).toEqual([]);
  });
});
