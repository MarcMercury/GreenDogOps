import { describe, expect, it } from "vitest";
import {
  approvedCount,
  isApproved,
  missingRunIdCount,
  sumTotals,
  unknownFlsaCount,
} from "./period-summary";

const totals = (regular: number, overtime = 0, doubleTime = 0) => ({
  regular,
  overtime,
  doubleTime,
  worked: regular + overtime + doubleTime,
});

const approved = {
  approval: { approved_at: "2026-10-05T18:00:00Z", approved_by_name: "Pat", stale: false },
  adp_employee_id: "E100",
  flsa: "non_exempt" as const,
  result: { totals: totals(480, 60) },
};

const staleAndIncomplete = {
  approval: { approved_at: "2026-10-04T18:00:00Z", approved_by_name: null, stale: true },
  adp_employee_id: null,
  flsa: "unknown" as const,
  result: { totals: totals(300, 0, 30) },
};

const unapproved = {
  approval: null,
  adp_employee_id: "E200",
  flsa: "exempt" as const,
  result: { totals: totals(0) },
};

const rows = [approved, staleAndIncomplete, unapproved];

describe("isApproved", () => {
  it("counts only a current (non-stale) approval", () => {
    expect(isApproved(approved)).toBe(true);
    expect(isApproved(staleAndIncomplete)).toBe(false);
    expect(isApproved(unapproved)).toBe(false);
  });
});

describe("period counts", () => {
  it("counts current approvals, missing RUN ids and unknown FLSA", () => {
    expect(approvedCount(rows)).toBe(1);
    expect(missingRunIdCount(rows)).toBe(1);
    expect(unknownFlsaCount(rows)).toBe(1);
  });

  it("is zero for an empty period", () => {
    expect(approvedCount([])).toBe(0);
    expect(missingRunIdCount([])).toBe(0);
    expect(unknownFlsaCount([])).toBe(0);
    expect(sumTotals([], "worked")).toBe(0);
  });
});

describe("sumTotals", () => {
  it("adds one bucket across every timecard", () => {
    expect(sumTotals(rows, "regular")).toBe(780);
    expect(sumTotals(rows, "overtime")).toBe(60);
    expect(sumTotals(rows, "doubleTime")).toBe(30);
    expect(sumTotals(rows, "worked")).toBe(870);
  });
});
