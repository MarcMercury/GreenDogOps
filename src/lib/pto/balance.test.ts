import { describe, expect, it } from "vitest";
import { deductionDays, formatDays, overlaps, parseReview, parseSelfRequest, ptoBalancePatch, rangeDays, requestedDays } from "./balance";

const TODAY = "2026-10-14";
const req = (over: Partial<Parameters<typeof deductionDays>[0]> = {}) => ({
  kind: "pto",
  status: "approved",
  balance_tracked: true,
  pto_days: null,
  start_date: "2026-11-02",
  end_date: "2026-11-04",
  ...over,
});

describe("deductionDays (mirrors the 0246 trigger)", () => {
  it("an approved paid request uses every day in its range by default", () => {
    expect(deductionDays(req())).toBe(3);
    expect(deductionDays(req({ kind: "vacation" }))).toBe(3);
  });
  it("uses the explicit day count, including 0 and partial days", () => {
    expect(deductionDays(req({ pto_days: 2 }))).toBe(2);
    expect(deductionDays(req({ pto_days: "0.25" }))).toBe(0.25);
    expect(deductionDays(req({ pto_days: 0 }))).toBe(0);
  });
  it("pending, denied, unpaid and pre-Ops (untracked) requests never deduct", () => {
    expect(deductionDays(req({ status: "requested" }))).toBe(0);
    expect(deductionDays(req({ status: "denied" }))).toBe(0);
    expect(deductionDays(req({ kind: "time_off" }))).toBe(0);
    expect(deductionDays(req({ balance_tracked: false }))).toBe(0);
  });
});

describe("rangeDays / requestedDays / formatDays / overlaps", () => {
  it("counts inclusive calendar days across a DST change", () => {
    expect(rangeDays("2026-11-01", "2026-11-01")).toBe(1);
    expect(rangeDays("2026-10-31", "2026-11-02")).toBe(3);
    expect(requestedDays({ pto_days: null, start_date: "2026-11-01", end_date: "2026-11-07" })).toBe(7);
  });
  it("formats whole and partial days", () => {
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(3)).toBe("3 days");
    expect(formatDays(0.25)).toBe("2 h");
    expect(formatDays(0.31)).toBe("2.48 h");
    expect(formatDays(0)).toBe("0 days");
  });
  it("detects overlapping ranges", () => {
    expect(overlaps("2026-11-02", "2026-11-04", "2026-11-04", "2026-11-06")).toBe(true);
    expect(overlaps("2026-11-02", "2026-11-03", "2026-11-04", "2026-11-06")).toBe(false);
  });
});

describe("parseSelfRequest", () => {
  it("full days default to every day in the range", () => {
    expect(parseSelfRequest({ start: "2026-11-02", end: "2026-11-04", mode: "full" }, TODAY)).toEqual({
      ok: true,
      value: { start: "2026-11-02", end: "2026-11-04", ptoDays: 3, note: null },
    });
  });
  it("lets the employee use fewer days than the range (e.g. their days off)", () => {
    const r = parseSelfRequest({ start: "2026-11-02", end: "2026-11-08", mode: "full", days: "5", note: "  trip " }, TODAY);
    expect(r).toEqual({ ok: true, value: { start: "2026-11-02", end: "2026-11-08", ptoDays: 5, note: "trip" } });
  });
  it("a partial sick day is 2–8 hours on one day, stored as a fraction of 8 h", () => {
    expect(parseSelfRequest({ start: "2026-10-14", end: "2026-10-20", mode: "partial", hours: "2" }, TODAY)).toEqual({
      ok: true,
      value: { start: "2026-10-14", end: "2026-10-14", ptoDays: 0.25, note: null },
    });
    expect(parseSelfRequest({ start: "2026-10-14", mode: "partial", hours: "1.5" }, TODAY).ok).toBe(false);
    expect(parseSelfRequest({ start: "2026-10-14", mode: "partial", hours: "9" }, TODAY).ok).toBe(false);
    expect(parseSelfRequest({ start: "2026-10-14", mode: "partial", hours: "2.1" }, TODAY).ok).toBe(false);
  });
  it("allows sick time reported afterwards, up to 30 days back", () => {
    expect(parseSelfRequest({ start: "2026-09-14", mode: "full" }, TODAY).ok).toBe(true);
    expect(parseSelfRequest({ start: "2026-09-13", mode: "full" }, TODAY).ok).toBe(false);
  });
  it("rejects bad input", () => {
    expect(parseSelfRequest({ start: "", mode: "full" }, TODAY).ok).toBe(false);
    expect(parseSelfRequest({ start: "2026-11-04", end: "2026-11-02", mode: "full" }, TODAY).ok).toBe(false);
    expect(parseSelfRequest({ start: "2026-11-02", end: "2026-11-03", mode: "full", days: "3" }, TODAY).ok).toBe(false);
    expect(parseSelfRequest({ start: "2026-11-02", mode: "full", days: "0" }, TODAY).ok).toBe(false);
    expect(parseSelfRequest({ start: "2026-11-02", mode: "full", days: "1.5" }, TODAY).ok).toBe(false);
    expect(parseSelfRequest({ start: "2026-11-01", end: "2027-01-05", mode: "full" }, TODAY).ok).toBe(false);
    expect(parseSelfRequest({ start: "2028-01-01", mode: "full" }, TODAY).ok).toBe(false);
    expect(parseSelfRequest({ start: "2026-11-02", mode: "sick" }, TODAY).ok).toBe(false);
  });
});

describe("parseReview", () => {
  const range = { start_date: "2026-11-02", end_date: "2026-11-04" };
  it("approves as paid PTO with a day count (0 = approve without deducting)", () => {
    expect(parseReview({ decision: "approved", kind: "pto", days: "2" }, range)).toEqual({
      ok: true,
      value: { status: "approved", kind: "pto", ptoDays: 2, note: null },
    });
    expect(parseReview({ decision: "approved", kind: "pto", days: "0" }, range)).toMatchObject({ ok: true, value: { ptoDays: 0 } });
    expect(parseReview({ decision: "approved", kind: "pto", days: "" }, range)).toMatchObject({ ok: true, value: { ptoDays: null } });
  });
  it("accepts unpaid and denial with a note", () => {
    expect(parseReview({ decision: "denied", kind: "time_off", note: " short-staffed " }, range)).toMatchObject({
      ok: true,
      value: { status: "denied", note: "short-staffed" },
    });
  });
  it("rejects bad input", () => {
    expect(parseReview({ decision: "maybe", kind: "pto" }, range).ok).toBe(false);
    expect(parseReview({ decision: "approved", kind: "sick" }, range).ok).toBe(false);
    expect(parseReview({ decision: "approved", kind: "pto", days: "-1" }, range).ok).toBe(false);
    expect(parseReview({ decision: "approved", kind: "pto", days: "4" }, range).ok).toBe(false);
    expect(parseReview({ decision: "approved", kind: "pto", days: "1.234" }, range).ok).toBe(false);
  });
});

describe("ptoBalancePatch (HR profile save)", () => {
  const form = (o: Record<string, string>) => (k: string) => (k in o ? o[k] : null);
  it("an untouched (possibly stale) form writes nothing", () => {
    expect(ptoBalancePatch(form({ pto_used: "3", pto_used_was: "3", pto_available: "3", pto_available_was: "3" }))).toEqual({});
    expect(ptoBalancePatch(form({ pto_used: "", pto_used_was: "", pto_available: "", pto_available_was: "" }))).toEqual({});
  });
  it("writes only the field HR changed", () => {
    expect(ptoBalancePatch(form({ pto_used: "3", pto_used_was: "3", pto_available: "4.5", pto_available_was: "3" }))).toEqual({
      pto_available: 4.5,
    });
    expect(ptoBalancePatch(form({ pto_used: "", pto_used_was: "2", pto_available: "1", pto_available_was: "1" }))).toEqual({
      pto_used: null,
    });
  });
  it("ignores forms without the loaded values and non-numbers", () => {
    expect(ptoBalancePatch(form({ pto_used: "9", pto_available: "9" }))).toEqual({});
    expect(ptoBalancePatch(form({ pto_used: "abc", pto_used_was: "1" }))).toEqual({});
  });
});
