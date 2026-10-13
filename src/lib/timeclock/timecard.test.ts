import { describe, expect, it } from "vitest";
import { buildSessions, dayTotals, decimalHours, effectivePunches, formatDuration, type Punch } from "./timecard";
import type { PunchType } from "./state";

let n = 0;
function p(type: PunchType, at: string, workDate = "2026-10-13", rest: boolean | null = null): Punch {
  n += 1;
  return { id: `p${n}`, punch_type: type, punched_at: at, work_date: workDate, location_id: "loc", rest_breaks_ok: rest };
}
const NOW = new Date("2026-10-14T03:00:00Z");
const H = 3_600_000;
const M = 60_000;

describe("buildSessions", () => {
  it("computes worked time net of lunch, to the exact minute (no rounding)", () => {
    const [s] = buildSessions(
      [
        p("clock_in", "2026-10-13T15:02:00Z"),
        p("lunch_start", "2026-10-13T19:00:00Z"),
        p("lunch_end", "2026-10-13T19:31:00Z"),
        p("clock_out", "2026-10-13T23:33:00Z", "2026-10-13", true),
      ],
      NOW,
    );
    expect(s.status).toBe("complete");
    expect(s.lunch_ms).toBe(31 * M);
    expect(s.worked_ms).toBe(8 * H);
    expect(s.rest_breaks_ok).toBe(true);
  });

  it("accepts input in any order", () => {
    const [s] = buildSessions(
      [p("clock_out", "2026-10-13T23:00:00Z"), p("clock_in", "2026-10-13T15:00:00Z")],
      NOW,
    );
    expect(s.worked_ms).toBe(8 * H);
  });

  it("ends a lunch at clock-out when the person clocks out from lunch", () => {
    const [s] = buildSessions(
      [
        p("clock_in", "2026-10-13T15:00:00Z"),
        p("lunch_start", "2026-10-13T22:30:00Z"),
        p("clock_out", "2026-10-13T23:00:00Z"),
      ],
      NOW,
    );
    expect(s.lunches).toEqual([{ start: "2026-10-13T22:30:00Z", end: "2026-10-13T23:00:00Z" }]);
    expect(s.worked_ms).toBe(7.5 * H);
  });

  it("splits a split shift into two sessions on the same day", () => {
    const sessions = buildSessions(
      [
        p("clock_in", "2026-10-13T15:00:00Z"),
        p("clock_out", "2026-10-13T18:00:00Z"),
        p("clock_in", "2026-10-13T21:00:00Z"),
        p("clock_out", "2026-10-14T01:00:00Z"),
      ],
      NOW,
    );
    expect(sessions.map((s) => s.worked_ms)).toEqual([3 * H, 4 * H]);
    const [day] = dayTotals(sessions);
    expect(day.worked_ms).toBe(7 * H);
    expect(day.needs_correction).toBe(false);
  });

  it("keeps an overnight shift on its clock-in date", () => {
    const sessions = buildSessions(
      [p("clock_in", "2026-10-14T04:00:00Z", "2026-10-13"), p("clock_out", "2026-10-14T12:00:00Z", "2026-10-13")],
      new Date("2026-10-14T13:00:00Z"),
    );
    expect(dayTotals(sessions).map((d) => d.work_date)).toEqual(["2026-10-13"]);
  });

  it("counts an in-progress session up to now, minus a lunch under way", () => {
    const now = new Date("2026-10-13T20:00:00Z");
    const [s] = buildSessions(
      [p("clock_in", "2026-10-13T15:00:00Z"), p("lunch_start", "2026-10-13T19:30:00Z")],
      now,
    );
    expect(s.status).toBe("open");
    expect(s.worked_ms).toBe(4.5 * H);
  });

  it("flags a forgotten clock-out (a new clock-in, or stale) and never invents hours", () => {
    const sessions = buildSessions(
      [
        p("clock_in", "2026-10-12T15:00:00Z", "2026-10-12"),
        p("clock_in", "2026-10-13T15:00:00Z"),
        p("clock_out", "2026-10-13T23:00:00Z"),
      ],
      NOW,
    );
    expect(sessions[0].status).toBe("missing_clock_out");
    expect(sessions[0].worked_ms).toBeNull();
    expect(sessions[1].status).toBe("complete");

    const [stale] = buildSessions([p("clock_in", "2026-10-12T15:00:00Z", "2026-10-12")], NOW);
    expect(stale.status).toBe("missing_clock_out");
    expect(stale.worked_ms).toBeNull();
    const days = dayTotals([...sessions, stale]);
    expect(days.find((d) => d.work_date === "2026-10-12")?.needs_correction).toBe(true);
  });

  it("flags punches with no clock-in", () => {
    const [s] = buildSessions([p("clock_out", "2026-10-13T23:00:00Z")], NOW);
    expect(s.status).toBe("missing_clock_in");
    expect(s.worked_ms).toBeNull();
  });
});

describe("formatting", () => {
  it("shows durations and decimal hours", () => {
    expect(formatDuration(7 * H + 31 * M + 59_000)).toBe("7h 31m");
    expect(formatDuration(45 * M)).toBe("45m");
    expect(formatDuration(-5)).toBe("0m");
    expect(decimalHours(7 * H + 31 * M)).toBe("7.52");
  });
});

describe("effectivePunches", () => {
  const raw = (id: string, type: PunchType, at: string, needsApproval = false) => ({
    ...p(type, at),
    id,
    location_check: needsApproval ? "off_site" : "on_site",
    needs_approval: needsApproval,
  });
  const base = { work_date: "2026-10-13", reason: "r", created_at: "2026-10-14T00:00:00Z" };

  it("drops voided punches and adds, includes approver adds, and marks off-site approval", () => {
    const punches = [
      raw("in", "clock_in", "2026-10-13T15:00:00Z", true),
      raw("out", "clock_out", "2026-10-13T23:30:00Z"),
    ];
    const adjustments = [
      { ...base, id: "v1", action: "void" as const, punch_type: null, punched_at: null, voids_punch_id: "out", voids_adjustment_id: null },
      { ...base, id: "a1", action: "add" as const, punch_type: "clock_out" as const, punched_at: "2026-10-13T23:00:00Z", voids_punch_id: null, voids_adjustment_id: null },
      { ...base, id: "a2", action: "add" as const, punch_type: "lunch_start" as const, punched_at: "2026-10-13T19:00:00Z", voids_punch_id: null, voids_adjustment_id: null },
      { ...base, id: "v2", action: "void" as const, punch_type: null, punched_at: null, voids_punch_id: null, voids_adjustment_id: "a2" },
    ];
    const eff = effectivePunches(punches, adjustments, []);
    expect(eff.map((e) => e.id)).toEqual(["in", "a1"]);
    expect(eff[0].approval).toBe("pending");
    expect(eff[1]).toMatchObject({ origin: "adjustment", reason: "r" });
    expect(effectivePunches(punches, adjustments, [{ punch_id: "in", decision: "approved" }])[0].approval).toBe("approved");
    const [s] = buildSessions(eff, NOW);
    expect(s.status).toBe("complete");
    expect(s.worked_ms).toBe(8 * H);
  });
});
