import { describe, expect, it } from "vitest";
import { buildSessions, type Punch } from "../timeclock/timecard";
import type { PunchType } from "../timeclock/state";
import { approvalBlockers, checkMeals, computePeriod, dayBreaks, hours, type DayWaivers, type FlsaClass } from "./ca-rules";

// Times are UTC; the engine only uses differences and the work_date given.
let n = 0;
function p(type: PunchType, at: string, date: string): Punch {
  n += 1;
  return { id: `p${n}`, punch_type: type, punched_at: at, work_date: date, location_id: null };
}
const NOW = new Date("2027-01-01T00:00:00Z");
const NO_WAIVERS: DayWaivers = { sixHour: false, secondMeal: false };

/** A day: clock in at 08:00Z, lunch at `lunchAt` hours for `lunchMin` minutes, clock out after `workedH` worked hours. */
function day(date: string, workedH: number, lunch: { atH: number; min: number } | null = { atH: 4, min: 30 }): Punch[] {
  const start = new Date(`${date}T08:00:00Z`).getTime();
  const out: Punch[] = [p("clock_in", new Date(start).toISOString(), date)];
  let endMs = start + workedH * 3600_000;
  if (lunch && workedH > lunch.atH) {
    const ls = start + lunch.atH * 3600_000;
    out.push(p("lunch_start", new Date(ls).toISOString(), date));
    out.push(p("lunch_end", new Date(ls + lunch.min * 60_000).toISOString(), date));
    endMs += lunch.min * 60_000;
  }
  out.push(p("clock_out", new Date(endMs).toISOString(), date));
  return out;
}

function period(punches: Punch[], flsa: FlsaClass = "non_exempt", waivers: DayWaivers = NO_WAIVERS, start = "2026-10-04", end = "2026-10-17") {
  return computePeriod({
    sessions: buildSessions(punches, NOW),
    periodStart: start,
    periodEnd: end,
    flsa,
    waiversAt: () => waivers,
  });
}

describe("daily overtime and double time", () => {
  it("splits a long day 8 / 4 / rest", () => {
    const [d] = period(day("2026-10-05", 13)).days;
    expect([d.regular, d.overtime, d.doubleTime].map(hours)).toEqual([8, 4, 1]);
  });
  it("leaves an 8-hour day all regular, with no rounding", () => {
    const [d] = period(day("2026-10-05", 8.25)).days;
    expect(hours(d.regular)).toBe(8);
    expect(d.overtime).toBe(15);
  });
});

describe("weekly overtime", () => {
  it("turns regular hours past 40 into overtime, without double counting daily OT", () => {
    // Sun–Fri: 9 h each = 6 × 8 regular (48) + 6 × 1 daily OT. Weekly: regular capped at 40.
    const punches = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].flatMap((d) => day(d, 9));
    const r = period(punches);
    expect(hours(r.totals.regular)).toBe(40);
    expect(hours(r.totals.overtime)).toBe(14); // 6 daily + 8 weekly
    expect(r.totals.doubleTime).toBe(0);
  });
});

describe("7th consecutive day", () => {
  it("pays the first 8 h of the 7th day at 1.5x and the rest at 2x", () => {
    const week = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].flatMap((d) => day(d, 4, null));
    const r = period([...week, ...day("2026-10-10", 10)]);
    const sat = r.days.find((d) => d.work_date === "2026-10-10")!;
    expect(sat.seventhDay).toBe(true);
    expect([sat.regular, sat.overtime, sat.doubleTime].map(hours)).toEqual([0, 8, 2]);
  });
  it("does not apply when a day was skipped", () => {
    const week = ["2026-10-04", "2026-10-05", "2026-10-07", "2026-10-08", "2026-10-09"].flatMap((d) => day(d, 4, null));
    const sat = period([...week, ...day("2026-10-10", 6)]).days.find((d) => d.work_date === "2026-10-10")!;
    expect(sat.seventhDay).toBe(false);
  });
});

describe("meal periods", () => {
  it("owes nothing at 5 hours or less", () => {
    expect(checkMeals(300, [], NO_WAIVERS)).toEqual({ premium: false, issue: null, waived: null });
  });
  it("owes a premium past 5 h without a meal, unless a six-hour waiver covers a ≤6 h day", () => {
    expect(checkMeals(330, [], NO_WAIVERS)).toMatchObject({ premium: true, issue: "no_meal" });
    expect(checkMeals(330, [], { sixHour: true, secondMeal: false })).toMatchObject({ premium: false, waived: "six_hour" });
    expect(checkMeals(400, [], { sixHour: true, secondMeal: false })).toMatchObject({ premium: true, issue: "no_meal" });
  });
  it("flags late and short meals", () => {
    expect(checkMeals(480, [{ workedBefore: 310, minutes: 30 }], NO_WAIVERS)).toMatchObject({ premium: true, issue: "late_meal" });
    expect(checkMeals(480, [{ workedBefore: 240, minutes: 20 }], NO_WAIVERS)).toMatchObject({ premium: true, issue: "short_meal" });
    expect(checkMeals(480, [{ workedBefore: 300, minutes: 30 }], NO_WAIVERS)).toMatchObject({ premium: false });
  });
  it("needs a second meal past 10 h, waivable up to 12 h when the first was taken", () => {
    const first = { workedBefore: 240, minutes: 30 };
    expect(checkMeals(660, [first], NO_WAIVERS)).toMatchObject({ premium: true, issue: "no_second_meal" });
    expect(checkMeals(660, [first], { sixHour: false, secondMeal: true })).toMatchObject({ premium: false, waived: "second_meal" });
    expect(checkMeals(750, [first], { sixHour: false, secondMeal: true })).toMatchObject({ premium: true });
    expect(checkMeals(660, [first, { workedBefore: 590, minutes: 30 }], NO_WAIVERS)).toMatchObject({ premium: false });
    expect(checkMeals(660, [first, { workedBefore: 620, minutes: 30 }], NO_WAIVERS)).toMatchObject({ issue: "late_second_meal" });
  });
  it("counts a split-shift gap as a break and finds breaks from punches", () => {
    const punches = [
      p("clock_in", "2026-10-05T08:00:00Z", "2026-10-05"),
      p("clock_out", "2026-10-05T12:00:00Z", "2026-10-05"),
      p("clock_in", "2026-10-05T12:45:00Z", "2026-10-05"),
      p("clock_out", "2026-10-05T16:00:00Z", "2026-10-05"),
    ];
    expect(dayBreaks(buildSessions(punches, NOW))).toEqual([{ workedBefore: 240, minutes: 45 }]);
    expect(period(punches).days[0].mealPremium).toBe(false);
  });
  it("gives at most one meal premium per day, from punches end to end", () => {
    const [d] = period(day("2026-10-05", 11, null)).days;
    expect(d.mealPremium).toBe(true);
    expect(d.mealIssue).toBe("no_meal");
  });
});

describe("no rest premiums, exempt staff, and approval blockers", () => {
  it("does not track rest breaks or pay rest premiums (10-minute breaks are not clocked)", () => {
    const r = period(day("2026-10-05", 8));
    expect(r.days[0]).not.toHaveProperty("restPremium");
    expect(r.totals).not.toHaveProperty("restPremiums");
  });
  it("reports exempt hours without overtime or premiums", () => {
    const r = period(day("2026-10-05", 13, null), "exempt");
    expect(r.days[0]).toMatchObject({ overtime: 0, doubleTime: 0, mealPremium: false });
    expect(hours(r.days[0].regular)).toBe(13);
  });
  it("does not count sessions missing a punch, and blocks approval until fixed", () => {
    const r = period([p("clock_in", "2026-10-05T08:00:00Z", "2026-10-05")]);
    expect(r.days[0]).toMatchObject({ worked: 0, incomplete: true });
    expect(approvalBlockers(r)).toEqual(["1 day(s) missing a punch"]);
  });
  it("only returns days inside the period but uses the whole workweek", () => {
    // Period starts Sun 10/04; a 10/03 day (previous workweek) is ignored.
    const r = period([...day("2026-10-03", 9), ...day("2026-10-04", 9)]);
    expect(r.days.map((d) => d.work_date)).toEqual(["2026-10-04"]);
  });
});
