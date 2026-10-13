import { describe, expect, it } from "vitest";
import { payDateFor, payPeriodFor, recentPayPeriods } from "./pay-period";

describe("pay calendar (D7)", () => {
  it("matches the anchor period", () => {
    expect(payPeriodFor("2026-09-20")).toEqual({ start: "2026-09-20", end: "2026-10-03", payDate: "2026-10-09" });
    expect(payPeriodFor("2026-10-03").start).toBe("2026-09-20");
  });

  it("rolls forward and backward in 14-day Sunday–Saturday periods", () => {
    expect(payPeriodFor("2026-10-13")).toEqual({ start: "2026-10-04", end: "2026-10-17", payDate: "2026-10-23" });
    expect(payPeriodFor("2026-09-19")).toEqual({ start: "2026-09-06", end: "2026-09-19", payDate: "2026-09-25" });
  });

  it("moves a Friday Fed holiday pay date to Thursday", () => {
    // Period 2026-12-13 – 12-26 would pay Fri 2027-01-01.
    expect(payPeriodFor("2026-12-20")).toEqual({ start: "2026-12-13", end: "2026-12-26", payDate: "2026-12-31" });
    expect(payDateFor("2026-12-26")).toBe("2026-12-31");
    // A Friday that is not a holiday is unchanged.
    expect(payDateFor("2026-10-17")).toBe("2026-10-23");
  });

  it("lists recent periods newest first", () => {
    expect(recentPayPeriods("2026-10-13", 3).map((p) => p.start)).toEqual(["2026-10-04", "2026-09-20", "2026-09-06"]);
  });
});
