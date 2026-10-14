import { describe, expect, it } from "vitest";
import { approvalStale, lockBlockers, snapshotOf } from "./period";

const totals = { worked: 600.004, regular: 480, overtime: 120.004, doubleTime: 0, mealPremiums: 1, restPremiums: 0, incompleteDays: 0, pendingDays: 0 };

describe("approval snapshots", () => {
  it("rounds minutes and detects changes after approval", () => {
    const snap = snapshotOf("non_exempt", "001", totals);
    expect(snap).toMatchObject({ worked: 600, overtime: 120, mealPremiums: 1, adp_employee_id: "001" });
    expect(approvalStale(snap, snap)).toBe(false);
    expect(approvalStale(snap, { ...snap, overtime: 135 })).toBe(true);
    expect(approvalStale(snap, { ...snap, adp_employee_id: "002" })).toBe(true);
    expect(approvalStale(null, snap)).toBe(false);
  });
});

describe("lockBlockers", () => {
  it("needs the period over and every timecard approved and current", () => {
    const ok = { approval: { stale: false } };
    expect(lockBlockers([ok], "2026-10-17", "2026-10-18")).toEqual([]);
    expect(lockBlockers([ok], "2026-10-17", "2026-10-17")).toEqual(["The period hasn't ended yet."]);
    expect(lockBlockers([ok, { approval: null }, { approval: { stale: true } }], "2026-10-17", "2026-10-20")).toEqual([
      "1 timecard(s) not approved.",
      "1 timecard(s) changed after approval — approve them again.",
    ]);
  });
});
