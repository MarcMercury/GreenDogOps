// California hours and premiums for one employee's pay period (go-live plan
// §C, §J; checklist item 21) — pure, no rounding (exact minutes).
//
//   Daily overtime   over 8 h in a workday = 1.5x, over 12 h = 2x.
//   7th day          the 7th consecutive workday in one workweek: the first
//                    8 h are 1.5x, over 8 h are 2x.
//   Weekly overtime  regular hours over 40 in a workweek (Sun–Sat) = 1.5x
//                    (hours already paid as daily OT are not counted twice).
//   Meal periods     a 30-minute meal must start before the end of the 5th
//                    hour of work, a second before the end of the 10th.
//                    Waivers (signed in My Time) excuse: the first meal on a
//                    day of 6 h or less; the second meal on a day of 12 h or
//                    less when the first meal was taken. At most one meal
//                    premium hour per day.
//   Rest breaks      the employee answered "No" at a clock-out on a day of
//                    3.5 h or more → one rest premium hour (at most one per day).
//   Exempt staff     hours are reported; no overtime or premiums.
//
// A "workday" is the clinic-time-zone date of the clock-in (an overnight shift
// belongs to the day it started). Sessions missing a punch are not counted
// until corrected; the day is flagged instead.

import { addDays, weekdayOf } from "../worklist/dates";

export const DAILY_OT_AFTER = 8 * 60;
export const DAILY_DT_AFTER = 12 * 60;
export const WEEKLY_OT_AFTER = 40 * 60;
export const SEVENTH_DAY_DT_AFTER = 8 * 60;
export const MEAL_MIN_MINUTES = 30;
export const FIRST_MEAL_BY = 5 * 60;
export const SECOND_MEAL_BY = 10 * 60;
export const MEAL_REQUIRED_OVER = 5 * 60;
export const SIX_HOUR_WAIVER_MAX = 6 * 60;
export const SECOND_MEAL_REQUIRED_OVER = 10 * 60;
export const SECOND_MEAL_WAIVER_MAX = 12 * 60;
export const REST_BREAK_MIN_DAY = 3.5 * 60;

export type FlsaClass = "exempt" | "non_exempt" | "unknown";

export interface DayWaivers {
  sixHour: boolean;
  secondMeal: boolean;
}

export interface Break {
  /** Minutes worked before the break started. */
  workedBefore: number;
  minutes: number;
}

export type MealIssue =
  | "no_meal"
  | "late_meal"
  | "short_meal"
  | "no_second_meal"
  | "late_second_meal"
  | "short_second_meal";

export const MEAL_ISSUE_LABELS: Record<MealIssue, string> = {
  no_meal: "No meal period",
  late_meal: "Meal started after the 5th hour",
  short_meal: "Meal under 30 minutes",
  no_second_meal: "No second meal period",
  late_second_meal: "Second meal started after the 10th hour",
  short_second_meal: "Second meal under 30 minutes",
};

export interface DayResult {
  work_date: string;
  worked: number;
  regular: number;
  overtime: number;
  doubleTime: number;
  seventhDay: boolean;
  mealPremium: boolean;
  mealIssue: MealIssue | null;
  /** A waiver excused a meal that would otherwise have been owed. */
  mealWaived: "six_hour" | "second_meal" | null;
  restPremium: boolean;
  /** Sessions missing a punch — not counted until corrected. */
  incomplete: boolean;
  /** Off-site punches waiting for approval. */
  pendingApproval: boolean;
  breaks: Break[];
}

export interface PeriodTotals {
  worked: number;
  regular: number;
  overtime: number;
  doubleTime: number;
  mealPremiums: number;
  restPremiums: number;
  incompleteDays: number;
  pendingDays: number;
}

export interface PeriodResult {
  flsa: FlsaClass;
  days: DayResult[];
  totals: PeriodTotals;
}

interface SessionLike {
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  lunches: { start: string; end: string | null }[];
  status: string;
  worked_ms: number | null;
  rest_breaks_ok: boolean | null;
  punches: readonly { punched_at: string; approval?: string | null }[];
}

const mins = (ms: number) => ms / 60_000;
const t = (iso: string) => new Date(iso).getTime();

/**
 * Breaks in a workday, in order, with the minutes worked before each: lunch
 * punches inside a session, and the gap between two sessions (a split shift
 * clocked out and back in counts as a break too).
 */
export function dayBreaks(sessions: readonly SessionLike[]): Break[] {
  const complete = sessions
    .filter((s) => s.status === "complete" && s.clock_in && s.clock_out)
    .sort((a, b) => t(a.clock_in!) - t(b.clock_in!));
  const breaks: Break[] = [];
  let worked = 0;
  let prevOut: number | null = null;
  for (const s of complete) {
    const inAt = t(s.clock_in!);
    if (prevOut !== null && inAt > prevOut) breaks.push({ workedBefore: worked, minutes: mins(inAt - prevOut) });
    let cursor = inAt;
    for (const l of [...s.lunches].sort((a, b) => t(a.start) - t(b.start))) {
      const ls = t(l.start);
      const le = l.end ? t(l.end) : t(s.clock_out!);
      worked += mins(ls - cursor);
      breaks.push({ workedBefore: worked, minutes: mins(le - ls) });
      cursor = le;
    }
    worked += mins(t(s.clock_out!) - cursor);
    prevOut = t(s.clock_out!);
  }
  return breaks;
}

export interface MealCheck {
  premium: boolean;
  issue: MealIssue | null;
  waived: "six_hour" | "second_meal" | null;
}

/** Meal-period compliance for one workday (non-exempt). */
export function checkMeals(worked: number, breaks: readonly Break[], waivers: DayWaivers): MealCheck {
  const ok = { premium: false, issue: null, waived: null } as const;
  if (worked <= MEAL_REQUIRED_OVER) return ok;

  const meals = breaks.filter((b) => b.minutes >= MEAL_MIN_MINUTES);
  const first = meals[0] ?? null;
  const firstTimely = !!first && first.workedBefore <= FIRST_MEAL_BY;

  if (!firstTimely) {
    if (worked <= SIX_HOUR_WAIVER_MAX && waivers.sixHour) return { premium: false, issue: null, waived: "six_hour" };
    const issue: MealIssue = first ? "late_meal" : breaks.length ? "short_meal" : "no_meal";
    return { premium: true, issue, waived: null };
  }

  if (worked <= SECOND_MEAL_REQUIRED_OVER) return ok;
  const second = meals[1] ?? null;
  if (second && second.workedBefore <= SECOND_MEAL_BY) return ok;
  if (worked <= SECOND_MEAL_WAIVER_MAX && waivers.secondMeal) return { premium: false, issue: null, waived: "second_meal" };
  const laterBreaks = breaks.slice(breaks.indexOf(first) + 1);
  const issue: MealIssue = second ? "late_second_meal" : laterBreaks.length ? "short_second_meal" : "no_second_meal";
  return { premium: true, issue, waived: null };
}

/** Sunday that starts the workweek containing `date`. */
export function workweekStart(date: string): string {
  return addDays(date, -weekdayOf(date));
}

/**
 * Compute one employee's days and totals. `sessions` are their effective-punch
 * sessions (buildSessions); `waiversAt(date)` gives the waivers in force at
 * that day's first clock-in. Only days in [periodStart, periodEnd] are
 * returned, but the whole workweeks are used for the 7th-day and weekly rules.
 */
export function computePeriod(input: {
  sessions: readonly SessionLike[];
  periodStart: string;
  periodEnd: string;
  flsa: FlsaClass;
  waiversAt: (workDate: string, firstClockIn: string | null) => DayWaivers;
}): PeriodResult {
  const byDate = new Map<string, SessionLike[]>();
  for (const s of input.sessions) {
    const list = byDate.get(s.work_date) ?? [];
    list.push(s);
    byDate.set(s.work_date, list);
  }
  const dates = [...byDate.keys()].sort();

  const raw = new Map<string, DayResult>();
  for (const date of dates) {
    const sessions = byDate.get(date)!;
    const complete = sessions.filter((s) => s.status === "complete" && s.worked_ms !== null);
    const worked = Math.round(complete.reduce((n, s) => n + mins(s.worked_ms!), 0) * 100) / 100;
    const breaks = dayBreaks(sessions);
    const firstIn = complete.map((s) => s.clock_in).filter((v): v is string => !!v).sort()[0] ?? null;
    const exempt = input.flsa === "exempt";
    const meal = exempt ? { premium: false, issue: null, waived: null } : checkMeals(worked, breaks, input.waiversAt(date, firstIn));
    const restNo = complete.some((s) => s.rest_breaks_ok === false);
    raw.set(date, {
      work_date: date,
      worked,
      regular: 0,
      overtime: 0,
      doubleTime: 0,
      seventhDay: false,
      mealPremium: meal.premium,
      mealIssue: meal.issue,
      mealWaived: meal.waived,
      restPremium: !exempt && restNo && worked >= REST_BREAK_MIN_DAY,
      incomplete: sessions.some((s) => s.status === "missing_clock_in" || s.status === "missing_clock_out"),
      pendingApproval: sessions.some((s) => s.punches.some((p) => p.approval === "pending")),
      breaks,
    });
  }

  // Overtime per workweek, in date order.
  const weeks = new Map<string, DayResult[]>();
  for (const d of raw.values()) {
    const wk = workweekStart(d.work_date);
    weeks.set(wk, [...(weeks.get(wk) ?? []), d]);
  }
  for (const [weekStart, days] of weeks) {
    days.sort((a, b) => a.work_date.localeCompare(b.work_date));
    const workedDates = new Set(days.filter((d) => d.worked > 0).map((d) => d.work_date));
    let weeklyRegular = 0;
    for (const d of days) {
      if (input.flsa === "exempt") {
        d.regular = d.worked;
        continue;
      }
      // 7th consecutive day: worked every day Sun–Fri of this workweek.
      const isSeventh =
        weekdayOf(d.work_date) === 6 &&
        d.worked > 0 &&
        [0, 1, 2, 3, 4, 5].every((i) => workedDates.has(addDays(weekStart, i)));
      if (isSeventh) {
        d.seventhDay = true;
        d.overtime = Math.min(d.worked, SEVENTH_DAY_DT_AFTER);
        d.doubleTime = Math.max(d.worked - SEVENTH_DAY_DT_AFTER, 0);
        d.regular = 0;
        continue;
      }
      let regular = Math.min(d.worked, DAILY_OT_AFTER);
      d.overtime = Math.min(Math.max(d.worked - DAILY_OT_AFTER, 0), DAILY_DT_AFTER - DAILY_OT_AFTER);
      d.doubleTime = Math.max(d.worked - DAILY_DT_AFTER, 0);
      // Weekly: regular minutes beyond 40 h become overtime.
      const room = Math.max(WEEKLY_OT_AFTER - weeklyRegular, 0);
      if (regular > room) {
        d.overtime += regular - room;
        regular = room;
      }
      weeklyRegular += regular;
      d.regular = regular;
    }
  }

  const days = [...raw.values()]
    .filter((d) => d.work_date >= input.periodStart && d.work_date <= input.periodEnd)
    .sort((a, b) => a.work_date.localeCompare(b.work_date));
  const totals: PeriodTotals = {
    worked: 0,
    regular: 0,
    overtime: 0,
    doubleTime: 0,
    mealPremiums: 0,
    restPremiums: 0,
    incompleteDays: 0,
    pendingDays: 0,
  };
  for (const d of days) {
    totals.worked += d.worked;
    totals.regular += d.regular;
    totals.overtime += d.overtime;
    totals.doubleTime += d.doubleTime;
    totals.mealPremiums += d.mealPremium ? 1 : 0;
    totals.restPremiums += d.restPremium ? 1 : 0;
    totals.incompleteDays += d.incomplete ? 1 : 0;
    totals.pendingDays += d.pendingApproval ? 1 : 0;
  }
  return { flsa: input.flsa, days, totals };
}

/** Minutes → decimal hours, 2 places (payroll convention). */
export function hours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** Can this person's timecard be approved? */
export function approvalBlockers(r: PeriodResult): string[] {
  const out: string[] = [];
  if (r.totals.incompleteDays > 0) out.push(`${r.totals.incompleteDays} day(s) missing a punch`);
  if (r.totals.pendingDays > 0) out.push(`${r.totals.pendingDays} day(s) with off-site punches to approve`);
  return out;
}
