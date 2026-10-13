import { describe, expect, it } from "vitest";
import {
  attendanceLiveFor,
  DEFAULT_THRESHOLDS,
  gradeShift,
  gradeToAttendance,
  matchSessions,
  shiftWindow,
  type ShiftInput,
} from "./attendance";
import { buildSessions, type Punch } from "./timecard";

const TZ = "America/Los_Angeles";
// Tue 2026-10-13, PDT (UTC-7). 08:00 local = 15:00Z, 17:00 local = 00:00Z next day.
const shift = (over: Partial<ShiftInput> = {}): ShiftInput => ({
  assignment_id: "a1",
  person_id: "p",
  work_date: "2026-10-13",
  location_id: "L",
  start_time: "08:00:00",
  end_time: "17:00:00",
  ...over,
});
let n = 0;
const punch = (type: Punch["punch_type"], at: string, assignment: string | null = null) => ({
  id: `x${++n}`,
  punch_type: type,
  punched_at: at,
  work_date: "2026-10-13",
  location_id: "L",
  rest_breaks_ok: null,
  assignment_id: assignment,
});
const opts = (now: string, onPto = false) => ({ now: new Date(now), timeZone: TZ, thresholds: DEFAULT_THRESHOLDS, onPto });
const sessionOf = (punches: ReturnType<typeof punch>[], now: string) => buildSessions(punches, new Date(now))[0];

describe("shiftWindow", () => {
  it("resolves local shift times, including overnight", () => {
    expect(shiftWindow(shift(), TZ).start?.toISOString()).toBe("2026-10-13T15:00:00.000Z");
    expect(shiftWindow(shift({ start_time: "22:00:00", end_time: "06:00:00" }), TZ).end?.toISOString()).toBe("2026-10-14T13:00:00.000Z");
    expect(shiftWindow(shift({ start_time: null, end_time: null }), TZ)).toEqual({ start: null, end: null });
  });
});

describe("gradeShift without punches", () => {
  it("moves from upcoming to not-in-yet to missed", () => {
    expect(gradeShift(shift(), null, opts("2026-10-13T14:00:00Z")).state).toBe("upcoming");
    expect(gradeShift(shift(), null, opts("2026-10-13T15:30:00Z")).state).toBe("not_in_yet");
    expect(gradeShift(shift(), null, opts("2026-10-13T16:00:00Z")).state).toBe("missed");
  });
  it("is PTO with approved time off", () => {
    expect(gradeShift(shift(), null, opts("2026-10-13T18:00:00Z", true)).state).toBe("pto");
  });
  it("misses an untimed shift only once the day is over", () => {
    const s = shift({ start_time: null, end_time: null });
    expect(gradeShift(s, null, opts("2026-10-14T05:00:00Z")).state).toBe("upcoming"); // 10pm local
    expect(gradeShift(s, null, opts("2026-10-14T07:30:00Z")).state).toBe("missed"); // 12:30am next day
  });
});

describe("gradeShift with punches", () => {
  it("grades on time, late and very late from the clock-in", () => {
    const at = (iso: string) => gradeShift(shift(), sessionOf([punch("clock_in", iso)], "2026-10-13T18:00:00Z"), opts("2026-10-13T18:00:00Z"));
    expect(at("2026-10-13T15:04:00Z")).toMatchObject({ state: "working", lateLevel: null, lateMinutes: 4 });
    expect(at("2026-10-13T15:10:00Z")).toMatchObject({ lateLevel: "late", lateMinutes: 10 });
    expect(at("2026-10-13T15:20:00Z")).toMatchObject({ lateLevel: "very_late", lateMinutes: 20 });
    expect(at("2026-10-13T14:50:00Z")).toMatchObject({ lateLevel: null, lateMinutes: -10 });
  });
  it("grades left early and completed from the clock-out", () => {
    const now = "2026-10-14T02:00:00Z";
    const early = sessionOf([punch("clock_in", "2026-10-13T15:00:00Z"), punch("clock_out", "2026-10-13T23:30:00Z")], now);
    expect(gradeShift(shift(), early, opts(now))).toMatchObject({ state: "left_early", leftEarlyMinutes: 30 });
    const full = sessionOf([punch("clock_in", "2026-10-13T15:00:00Z"), punch("clock_out", "2026-10-13T23:55:00Z")], now);
    expect(gradeShift(shift(), full, opts(now)).state).toBe("completed");
  });
  it("flags a session that never clocked out", () => {
    const now = "2026-10-14T12:00:00Z"; // 21 h later → stale
    const s = sessionOf([punch("clock_in", "2026-10-13T15:00:00Z")], now);
    expect(gradeShift(shift(), s, opts(now)).state).toBe("incomplete");
  });
});

describe("matchSessions", () => {
  it("uses the shift matched at clock-in, then the nearest start, else unscheduled", () => {
    const am = shift({ assignment_id: "am", start_time: "08:00:00", end_time: "12:00:00" });
    const pm = shift({ assignment_id: "pm", start_time: "14:00:00", end_time: "18:00:00" });
    const now = new Date("2026-10-14T03:00:00Z");
    const sessions = buildSessions(
      [
        punch("clock_in", "2026-10-13T21:05:00Z", null), // 2:05 pm → nearest pm
        punch("clock_out", "2026-10-14T01:00:00Z"),
        punch("clock_in", "2026-10-13T15:00:00Z", "am"),
        punch("clock_out", "2026-10-13T19:00:00Z"),
      ],
      now,
    );
    const { bySession, unscheduled } = matchSessions([am, pm], sessions, TZ);
    expect(bySession.get("am")?.clock_in).toBe("2026-10-13T15:00:00Z");
    expect(bySession.get("pm")?.clock_in).toBe("2026-10-13T21:05:00Z");
    expect(unscheduled).toEqual([]);
    expect(matchSessions([], sessions, TZ).unscheduled.length).toBe(2);
  });
});

describe("gradeToAttendance and the live date", () => {
  it("maps grades onto attendance statuses", () => {
    expect(gradeToAttendance({ state: "missed", lateLevel: null })).toBe("absent");
    expect(gradeToAttendance({ state: "completed", lateLevel: "late" })).toBe("late");
    expect(gradeToAttendance({ state: "left_early", lateLevel: null })).toBe("present");
    expect(gradeToAttendance({ state: "not_in_yet", lateLevel: null })).toBe("scheduled");
    expect(gradeToAttendance({ state: "pto", lateLevel: null })).toBe("pto");
  });
  it("only counts grades from the go-live date", () => {
    expect(attendanceLiveFor("2026-10-20", null)).toBe(false);
    expect(attendanceLiveFor("2026-10-17", "2026-10-18")).toBe(false);
    expect(attendanceLiveFor("2026-10-18", "2026-10-18")).toBe(true);
  });
});
