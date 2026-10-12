import { describe, expect, it } from "vitest";
import { lastNameMatches, matchOptInPeople, normalizeName, type OptInCandidate } from "./opt-in";

const person = (over: Partial<OptInCandidate>): OptInCandidate => ({
  id: "p1",
  status: "employee",
  last_name: "Garcia",
  phone_mobile: "(310) 555-1234",
  ...over,
});

describe("normalizeName", () => {
  it("ignores case, accents, spaces and punctuation", () => {
    expect(normalizeName(" José O'Neil-Smith ")).toBe("joseoneilsmith");
    expect(normalizeName(null)).toBe("");
  });
});

describe("lastNameMatches", () => {
  it("matches the full last name or one part of a compound one", () => {
    expect(lastNameMatches("Garcia-Lopez", "garcia lopez")).toBe(true);
    expect(lastNameMatches("Garcia-Lopez", "Lopez")).toBe(true);
    expect(lastNameMatches("De la Cruz", "Cruz")).toBe(true);
    expect(lastNameMatches("Núñez", "Nunez")).toBe(true);
  });

  it("rejects different or empty names", () => {
    expect(lastNameMatches("Garcia", "Gar")).toBe(false);
    expect(lastNameMatches("Garcia", "Smith")).toBe(false);
    expect(lastNameMatches("Garcia", "  ")).toBe(false);
  });
});

describe("matchOptInPeople", () => {
  const phone = "+13105551234";

  it("matches the number in any stored format", () => {
    for (const stored of ["(310) 555-1234", "310.555.1234", "310 555 1234", "3105551234", "(310) 555-1234\u202c"]) {
      expect(matchOptInPeople([person({ phone_mobile: stored })], { lastName: "Garcia", phone }), stored).toEqual(["p1"]);
    }
  });

  it("needs the same number and last name", () => {
    expect(matchOptInPeople([person({ phone_mobile: "(310) 555-9999" })], { lastName: "Garcia", phone })).toEqual([]);
    expect(matchOptInPeople([person({})], { lastName: "Smith", phone })).toEqual([]);
  });

  it("covers candidates and employees, never former employees", () => {
    const people = [
      person({ id: "emp" }),
      person({ id: "app", status: "applicant" }),
      person({ id: "old", status: "former" }),
    ];
    expect(matchOptInPeople(people, { lastName: "garcia", phone })).toEqual(["emp", "app"]);
  });

  it("caps how many profiles one opt-in can touch", () => {
    const many = Array.from({ length: 8 }, (_, i) => person({ id: `p${i}` }));
    expect(matchOptInPeople(many, { lastName: "Garcia", phone }, 5)).toHaveLength(5);
  });
});
