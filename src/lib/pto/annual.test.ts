import { describe, expect, it } from "vitest";
import { allotmentFor, daysInYear, firstYearGrant, nextStepAnniversary, separationPayoutDays, tenureStepIn, vestedDays } from "./annual";

describe("PTO annual rules (plan §H worked examples)", () => {
  it("prorates year 1, rounds up, and never goes below the 5-day sick-leave floor", () => {
    // Hired 2026-07-01, allotment 6 → 6 × 184/365 = 3.02 → 4 → raised to 5.
    expect(firstYearGrant(6, "2026-07-01")).toBe(5);
    expect(firstYearGrant(6, "2026-07-01", false)).toBe(4);
    expect(firstYearGrant(14, "2026-01-01")).toBe(14);
    expect(firstYearGrant(14, "2026-12-31", false)).toBe(1);
  });
  it("adds 2 days from the Jan 1 after a 2nd / 4th / 6th anniversary, no true-up", () => {
    expect(tenureStepIn("2024-03-15", 2026)).toBe(true);
    expect(tenureStepIn("2024-03-15", 2025)).toBe(false);
    expect(tenureStepIn("2024-03-15", 2024)).toBe(false);
    expect(allotmentFor(6, "2024-03-15", 2027)).toBe(8);
    expect(allotmentFor(6, "2024-03-15", 2026)).toBe(6);
    expect(allotmentFor(8, "2024-03-15", 2029)).toBe(10);
  });
  it("finds the next step anniversary", () => {
    expect(nextStepAnniversary("2024-03-15", "2026-10-14")).toBe("2028-03-15");
    expect(nextStepAnniversary("2024-11-01", "2026-10-14")).toBe("2026-11-01");
    expect(nextStepAnniversary("2026-05-01", "2026-10-14")).toBe("2028-05-01");
    expect(nextStepAnniversary("2024-02-29", "2026-01-01")).toBe("2026-02-28");
  });
  it("vests pro rata and pays vested − taken at separation", () => {
    // Allotment 8, leaves 2026-06-30 having taken 2 → 8 × 181/365 = 3.97 → 1.97.
    expect(vestedDays(8, "2026-06-30")).toBe(3.97);
    expect(separationPayoutDays(8, "2026-06-30", 2)).toBe(1.97);
    expect(vestedDays(6, "2026-12-31", "2026-07-01")).toBe(3.02);
    expect(separationPayoutDays(6, "2026-02-01", 3)).toBeLessThan(0);
  });
  it("knows leap years", () => {
    expect(daysInYear(2028)).toBe(366);
    expect(daysInYear(2026)).toBe(365);
    expect(daysInYear(2100)).toBe(365);
  });
});
