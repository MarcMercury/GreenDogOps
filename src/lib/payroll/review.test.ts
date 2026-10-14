import { describe, expect, it } from "vitest";
import {
  applyOverrides,
  freezeLines,
  hoursFromSnapshot,
  ptoHoursInPeriod,
  reviewBlockers,
  reviewStale,
  reviewTotals,
  reviewWarnings,
  zeroHours,
  type PayLine,
} from "./review";

const P = "2026-10-04";
const E = "2026-10-17";
const req = (start: string, end: string, over: Partial<{ kind: string; status: string; pto_days: number | null }> = {}) => ({
  person_id: "a",
  kind: "pto",
  status: "approved",
  start_date: start,
  end_date: end,
  pto_days: null as number | null,
  ...over,
});

describe("ptoHoursInPeriod", () => {
  it("counts approved paid days in the period at 8 h a day", () => {
    expect(ptoHoursInPeriod([req("2026-10-06", "2026-10-08")], P, E)).toBe(24);
    expect(ptoHoursInPeriod([req("2026-10-06", "2026-10-06", { pto_days: 1 })], P, E)).toBe(8);
  });
  it("counts only the days inside the period for a straddling request", () => {
    expect(ptoHoursInPeriod([req("2026-10-15", "2026-10-20")], P, E)).toBe(24);
    expect(ptoHoursInPeriod([req("2026-10-01", "2026-10-05")], P, E)).toBe(16);
  });
  it("spreads fewer PTO days than calendar days evenly", () => {
    // 7-day range using 5 PTO days, all inside → 40 h.
    expect(ptoHoursInPeriod([req("2026-10-04", "2026-10-10", { pto_days: 5 })], P, E)).toBe(40);
  });
  it("gives each period whole 8-hour days when a request straddles periods, and they add up", () => {
    // 7-day range using 5 PTO days, 4 calendar days in this period, 3 in the next.
    const r = req("2026-10-14", "2026-10-20", { pto_days: 5 });
    const here = ptoHoursInPeriod([r], P, E);
    const next = ptoHoursInPeriod([r], "2026-10-18", "2026-10-31");
    expect(here % 8).toBe(0);
    expect(next % 8).toBe(0);
    expect(here).toBe(24);
    expect(here + next).toBe(40);
  });
  it("ignores pending, denied and unpaid requests", () => {
    expect(
      ptoHoursInPeriod(
        [req("2026-10-06", "2026-10-06", { status: "requested" }), req("2026-10-07", "2026-10-07", { status: "denied" }), req("2026-10-08", "2026-10-08", { kind: "time_off" })],
        P,
        E,
      ),
    ).toBe(0);
  });
});

const base = (over: Partial<PayLine> = {}): Omit<PayLine, "hours" | "overridden" | "excluded" | "reasons"> => ({
  person_id: "p1",
  name: "Alex",
  adp_employee_id: "1001",
  flsa: "non_exempt",
  calculated: { ...zeroHours(), regular: 72, overtime: 3, meal_premium: 1 },
  ...over,
});
const ov = (field: string, hours: number | null, at: string, reason = "r") => ({ person_id: "p1", field, hours, reason, created_at: at });

describe("applyOverrides", () => {
  it("keeps calculated hours when there are no overrides", () => {
    const l = applyOverrides(base(), []);
    expect(l.hours).toEqual(base().calculated);
    expect(l.overridden).toEqual([]);
    expect(l.excluded).toBe(false);
  });
  it("the newest override per field wins, and null clears it", () => {
    const l = applyOverrides(base(), [ov("overtime", 5, "2026-10-19T10:00:00Z", "late fix"), ov("overtime", 4, "2026-10-19T09:00:00Z")]);
    expect(l.hours.overtime).toBe(5);
    expect(l.overridden).toEqual(["overtime"]);
    expect(l.reasons).toEqual(["late fix"]);
    const cleared = applyOverrides(base(), [ov("overtime", 5, "2026-10-19T09:00:00Z"), ov("overtime", null, "2026-10-19T10:00:00Z")]);
    expect(cleared.hours.overtime).toBe(3);
    expect(cleared.overridden).toEqual([]);
  });
  it("can leave someone out of the export and bring them back", () => {
    expect(applyOverrides(base(), [ov("exclude", 1, "2026-10-19T09:00:00Z", "salaried")]).excluded).toBe(true);
    expect(applyOverrides(base(), [ov("exclude", 1, "2026-10-19T09:00:00Z"), ov("exclude", 0, "2026-10-19T10:00:00Z")]).excluded).toBe(false);
  });
  it("ignores unknown fields", () => {
    expect(applyOverrides(base(), [ov("bonus", 100, "2026-10-19T09:00:00Z")]).hours).toEqual(base().calculated);
  });
});

describe("blockers, warnings, freeze", () => {
  const line = (over: Partial<PayLine>): PayLine => ({ ...applyOverrides(base(), []), ...over });
  it("blocks employees with hours but no ADP RUN ID, unless left out", () => {
    expect(reviewBlockers([line({ adp_employee_id: null })])[0]).toMatch(/no ADP RUN Employee ID/);
    expect(reviewBlockers([line({ adp_employee_id: null, excluded: true })])).toEqual([]);
    expect(reviewBlockers([line({ adp_employee_id: null, hours: zeroHours() })])).toEqual([]);
  });
  it("blocks negative hours", () => {
    expect(reviewBlockers([line({ hours: { ...zeroHours(), regular: -1 } })])).toHaveLength(1);
  });
  it("warns about unknown FLSA and salaried staff with hours", () => {
    const w = reviewWarnings([line({ flsa: "unknown" }), line({ person_id: "p2", flsa: "exempt" })]);
    expect(w).toHaveLength(2);
  });
  it("freezes only included lines and detects later changes", () => {
    const lines = [line({}), line({ person_id: "p2", name: "Bo", excluded: true })];
    const frozen = freezeLines(lines);
    expect(frozen.map((l) => l.person_id)).toEqual(["p1"]);
    expect(reviewStale(frozen, lines)).toBe(false);
    expect(reviewStale(frozen, [line({ hours: { ...zeroHours(), regular: 72, overtime: 3, meal_premium: 1, pto: 8 } })])).toBe(true);
    expect(reviewStale(null, lines)).toBe(false);
    expect(reviewTotals(frozen)).toMatchObject({ employees: 1, regular: 72, overtime: 3, meal_premium: 1 });
  });
  it("converts a timecard snapshot from minutes to hours", () => {
    expect(
      hoursFromSnapshot({ flsa: "non_exempt", adp_employee_id: "1", worked: 600, regular: 480, overtime: 90, doubleTime: 30, mealPremiums: 1 }),
    ).toEqual({ regular: 8, overtime: 1.5, double_time: 0.5, meal_premium: 1, pto: 0 });
    expect(hoursFromSnapshot(null)).toEqual(zeroHours());
  });
});
