import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeDocument } from "../resources/content";
import { activeWaiver, MEAL_WAIVER_DOCUMENT_IDS, signatureMatches, waiverInForce } from "./meal-waiver";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/0242_meal_waivers.sql"), "utf8");

describe("waiverInForce (mirrors meal_waiver_in_force in 0242)", () => {
  const recs = [
    { kind: "six_hour" as const, signed_at: "2026-10-01T16:00:00Z", revoked_at: "2026-10-10T16:00:00Z" },
    { kind: "six_hour" as const, signed_at: "2026-10-12T16:00:00Z", revoked_at: null },
  ];
  it("applies the waiver in force at the moment, so revoking never changes the past", () => {
    expect(waiverInForce(recs, "six_hour", new Date("2026-09-30T12:00:00Z"))).toBe(false);
    expect(waiverInForce(recs, "six_hour", new Date("2026-10-05T12:00:00Z"))).toBe(true);
    expect(waiverInForce(recs, "six_hour", new Date("2026-10-11T12:00:00Z"))).toBe(false);
    expect(waiverInForce(recs, "six_hour", new Date("2026-10-13T12:00:00Z"))).toBe(true);
    expect(waiverInForce(recs, "second_meal", new Date("2026-10-13T12:00:00Z"))).toBe(false);
    expect(activeWaiver(recs, "six_hour")?.signed_at).toBe("2026-10-12T16:00:00Z");
  });
  it("matches the SQL function's rule", () => {
    expect(migration).toContain("and w.signed_at <= p_at");
    expect(migration).toContain("and (w.revoked_at is null or w.revoked_at > p_at)");
  });
});

describe("signatureMatches", () => {
  const p = { first_name: "Jessica", last_name: "De La Cruz", preferred_name: "Jess" };
  it("accepts first or preferred + last name, ignoring case, accents and middle names", () => {
    expect(signatureMatches("Jessica De La Cruz", p)).toBe(true);
    expect(signatureMatches("jess de la cruz", p)).toBe(true);
    expect(signatureMatches("Jessica Marie De La Cruz", p)).toBe(true);
    expect(signatureMatches("José Núñez", { first_name: "Jose", last_name: "Nunez", preferred_name: null })).toBe(true);
  });
  it("rejects anything else", () => {
    expect(signatureMatches("Jessica", p)).toBe(false);
    expect(signatureMatches("J De La Cruz", p)).toBe(false);
    expect(signatureMatches("Jessica Smith", p)).toBe(false);
    expect(signatureMatches("x", { first_name: null, last_name: null, preferred_name: null })).toBe(false);
  });
});

describe("seeded waiver documents (0242)", () => {
  it("seeds both documents with the ids the app uses", () => {
    for (const id of Object.values(MEAL_WAIVER_DOCUMENT_IDS)) expect(migration).toContain(`'${id}'`);
  });
  it("stores content the policy editor accepts unchanged", () => {
    const docs = [...migration.matchAll(/'(\{"type":"doc".*?\})'::jsonb/g)].map((m) => JSON.parse(m[1].replace(/''/g, "'")));
    expect(docs.length).toBe(4); // document + version, for each waiver
    for (const d of docs) expect(sanitizeDocument(d)).toEqual(d);
  });
});
