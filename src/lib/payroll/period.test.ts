import { describe, expect, it } from "vitest";
import { approvalStale, exportTotals, interimExportCsv, lockBlockers, snapshotOf } from "./period";

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

describe("interim export", () => {
  it("writes one CSV row per employee with decimal hours, quoting names", () => {
    const csv = interimExportCsv("2026-10-04", "2026-10-17", [
      { name: "Smith, Jane", snapshot: snapshotOf("non_exempt", "001", totals) },
      { name: "Al Bo", snapshot: snapshotOf("exempt", null, { ...totals, overtime: 0, worked: 480 }) },
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "ADP RUN Employee ID,Employee,FLSA,Period start,Period end,Regular hours,Overtime hours (1.5x),Double-time hours (2x),Meal premium hours,Rest premium hours,Total worked hours",
    );
    expect(lines[1]).toBe(",Al Bo,Exempt,2026-10-04,2026-10-17,8.00,0.00,0.00,1.00,0.00,8.00");
    expect(lines[2]).toBe('001,"Smith, Jane",Non-exempt,2026-10-04,2026-10-17,8.00,2.00,0.00,1.00,0.00,10.00');
  });
  it("totals the export", () => {
    expect(exportTotals([{ name: "A", snapshot: snapshotOf("non_exempt", "1", totals) }])).toMatchObject({
      employees: 1,
      regular_hours: 8,
      overtime_hours: 2,
      meal_premiums: 1,
    });
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
