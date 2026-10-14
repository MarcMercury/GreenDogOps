import { describe, expect, it } from "vitest";
import { payPeriodFor, recentPayPeriods } from "@/lib/timeclock/pay-period";
import { addDays } from "@/lib/worklist/dates";
import { selectPayPeriod } from "./select-pay-period";

const today = "2026-10-13";
const recent = recentPayPeriods(today, 6);
const current = payPeriodFor(today);

describe("selectPayPeriod", () => {
  it("opens the period named by a valid period start", () => {
    expect(selectPayPeriod(current.start, recent)).toEqual(current);
    const previous = payPeriodFor(addDays(current.start, -1));
    expect(selectPayPeriod(previous.start, recent)).toEqual(previous);
  });

  it("falls back to the newest recent period without a parameter", () => {
    expect(selectPayPeriod(undefined, recent)).toBe(recent[0]);
    expect(selectPayPeriod("", recent)).toBe(recent[0]);
  });

  it("falls back for a mid-period day or a malformed value", () => {
    expect(selectPayPeriod(addDays(current.start, 1), recent)).toBe(recent[0]);
    expect(selectPayPeriod("2026-13-45", recent)).toBe(recent[0]);
    expect(selectPayPeriod("last-week", recent)).toBe(recent[0]);
  });
});
