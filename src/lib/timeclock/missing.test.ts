import { describe, expect, it } from "vitest";
import { clockOutDueAt, isClockOutOverdue } from "./missing";

const TZ = "America/Los_Angeles";

describe("missing clock-out", () => {
  it("is due an hour after the scheduled end", () => {
    const s = { clockInAt: "2026-10-13T15:00:00Z", workDate: "2026-10-13", shiftStart: "08:00:00", shiftEnd: "17:00:00" };
    expect(clockOutDueAt(s, TZ)?.toISOString()).toBe("2026-10-14T01:00:00.000Z"); // 6 PM PDT
    expect(isClockOutOverdue(s, new Date("2026-10-14T00:59:00Z"), TZ)).toBe(false);
    expect(isClockOutOverdue(s, new Date("2026-10-14T01:00:00Z"), TZ)).toBe(true);
  });

  it("handles overnight shifts", () => {
    const s = { clockInAt: "2026-10-14T05:00:00Z", workDate: "2026-10-13", shiftStart: "22:00:00", shiftEnd: "06:00:00" };
    expect(clockOutDueAt(s, TZ)?.toISOString()).toBe("2026-10-14T14:00:00.000Z"); // Oct 14, 7 AM PDT
  });

  it("falls back to 12 hours after clock-in with no shift", () => {
    const s = { clockInAt: "2026-10-13T15:00:00Z", workDate: "2026-10-13", shiftStart: null, shiftEnd: null };
    expect(clockOutDueAt(s, TZ)?.toISOString()).toBe("2026-10-14T03:00:00.000Z");
  });

  it("stops reminding after a week", () => {
    const s = { clockInAt: "2026-10-01T15:00:00Z", workDate: "2026-10-01", shiftStart: null, shiftEnd: null };
    expect(isClockOutOverdue(s, new Date("2026-10-13T15:00:00Z"), TZ)).toBe(false);
  });
});
