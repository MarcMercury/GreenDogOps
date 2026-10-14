import { describe, expect, it } from "vitest";
import type { LateLevel, ShiftState } from "@/lib/timeclock/attendance";
import { locationStats, sortShiftRows } from "@/features/scheduling/time-attendance/lib/location-stats";

const graded = (state: ShiftState, opts: { session?: boolean; lateLevel?: LateLevel } = {}) => ({
  state,
  lateLevel: opts.lateLevel ?? null,
  session: opts.session ? {} : null,
});

describe("locationStats", () => {
  it("counts each state and measures punch match over started shifts only", () => {
    const stats = locationStats([
      graded("working", { session: true, lateLevel: "late" }),
      graded("missed"),
      graded("upcoming"),
      graded("pto"),
      graded("completed", { session: true }),
      graded("left_early", { session: true, lateLevel: "very_late" }),
      graded("not_in_yet"),
    ]);
    expect(stats).toEqual({
      scheduled: 7,
      started: 5,
      matched: 3,
      working: 1,
      notInYet: 1,
      late: 2,
      missed: 1,
      done: 2,
      pto: 1,
      punchMatchLabel: "60%",
    });
  });

  it("reports a 50% match when one of two started shifts has a session", () => {
    const stats = locationStats([graded("working", { session: true }), graded("missed"), graded("upcoming")]);
    expect(stats.started).toBe(2);
    expect(stats.matched).toBe(1);
    expect(stats.punchMatchLabel).toBe("50%");
  });

  it("shows a dash before any shift has started", () => {
    const stats = locationStats([graded("upcoming"), graded("pto")]);
    expect(stats.started).toBe(0);
    expect(stats.punchMatchLabel).toBe("—");
  });

  it("rounds the match percentage", () => {
    const stats = locationStats([graded("working", { session: true }), graded("missed"), graded("missed")]);
    expect(stats.punchMatchLabel).toBe("33%");
  });
});

describe("sortShiftRows", () => {
  const row = (start_time: string | null, person_name: string) => ({ shift: { start_time, person_name } });

  it("orders by start time, then by name, with untimed shifts last", () => {
    const sorted = sortShiftRows([
      row(null, "Zed"),
      row("09:00:00", "Bea"),
      row("08:00:00", "Cy"),
      row("08:00:00", "Al"),
      row(null, "Ann"),
    ]);
    expect(sorted.map((r) => r.shift.person_name)).toEqual(["Al", "Cy", "Bea", "Ann", "Zed"]);
  });

  it("does not mutate the input", () => {
    const rows = [row("09:00:00", "Bea"), row("08:00:00", "Al")];
    sortShiftRows(rows);
    expect(rows.map((r) => r.shift.person_name)).toEqual(["Bea", "Al"]);
  });
});
