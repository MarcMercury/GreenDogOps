// "PTO & Timekeeping Rules" (go-live item 26, plan §I) — the plain-English
// explanation for Payroll / HR, generated from the same constants and
// functions the calculations use. Every worked example is computed by the real
// engine on fixed sample data, so the explanation can't drift from the
// behaviour; `rulesVersion` changes whenever any rule or example does, which
// invalidates earlier sign-offs.

import { createHash } from "node:crypto";
import { addDays } from "../worklist/dates";
import { buildSessions, type Punch } from "../timeclock/timecard";
import type { PunchType } from "../timeclock/state";
import { CORRECTION_WINDOW_DAYS, DUPLICATE_WINDOW_SECONDS } from "../timeclock/state";
import { PAY_PERIOD_ANCHOR, PAY_PERIOD_DAYS, payPeriodFor } from "../timeclock/pay-period";
import { MEAL_WAIVER_LABELS } from "../timeclock/meal-waiver";
import {
  checkMeals,
  computePeriod,
  DAILY_DT_AFTER,
  DAILY_OT_AFTER,
  FIRST_MEAL_BY,
  MEAL_ISSUE_LABELS,
  MEAL_MIN_MINUTES,
  MEAL_REQUIRED_OVER,
  SECOND_MEAL_BY,
  SECOND_MEAL_REQUIRED_OVER,
  SECOND_MEAL_WAIVER_MAX,
  SEVENTH_DAY_DT_AFTER,
  SIX_HOUR_WAIVER_MAX,
  WEEKLY_OT_AFTER,
  type MealCheck,
} from "../payroll/ca-rules";
import { deductionDays, formatDays, MIN_PARTIAL_HOURS, parseSelfRequest, PTO_BACKDATE_DAYS, PTO_DAY_HOURS } from "./balance";
import {
  allotmentFor,
  firstYearGrant,
  PTO_SICK_FLOOR_DAYS,
  separationPayoutDays,
  TENURE_STEP_DAYS,
  vestedDays,
} from "./annual";

export interface Rule {
  text: string;
  example?: string;
  why?: string;
}

export interface RuleSection {
  id: string;
  title: string;
  /** "live" = enforced by Ops today; "policy" = the agreed rule, not yet automated. */
  status: "live" | "policy";
  intro?: string;
  rules: Rule[];
}

const h = (minutes: number) => {
  const v = Math.round((minutes / 60) * 100) / 100;
  return `${v} h`;
};

// ---------------------------------------------------------------------------
// Sample timecards run through the real engine
// ---------------------------------------------------------------------------

let seq = 0;
function punch(type: PunchType, at: number, date: string): Punch {
  seq += 1;
  return { id: `ex${seq}`, punch_type: type, punched_at: new Date(at).toISOString(), work_date: date, location_id: null };
}

/** One workday: clock in 08:00Z, a 30-minute lunch after 4 h (if long enough), out after `hours` worked. */
function day(date: string, hours: number): Punch[] {
  const start = Date.parse(`${date}T08:00:00Z`);
  const out = [punch("clock_in", start, date)];
  let end = start + hours * 3_600_000;
  if (hours > 5) {
    const ls = start + 4 * 3_600_000;
    out.push(punch("lunch_start", ls, date), punch("lunch_end", ls + 30 * 60_000, date));
    end += 30 * 60_000;
  }
  out.push(punch("clock_out", end, date));
  return out;
}

const EX_WEEK = "2026-10-04"; // a Sunday inside the sample period

function run(punches: Punch[], flsa: "non_exempt" | "exempt" = "non_exempt") {
  const r = computePeriod({
    sessions: buildSessions(punches, new Date("2027-01-01T00:00:00Z")),
    periodStart: EX_WEEK,
    periodEnd: addDays(EX_WEEK, 13),
    flsa,
    waiversAt: () => ({ sixHour: false, secondMeal: false }),
  });
  return r.totals;
}

function totalsText(t: ReturnType<typeof run>): string {
  const parts = [`${h(t.regular)} regular`];
  if (t.overtime) parts.push(`${h(t.overtime)} overtime (1.5x)`);
  if (t.doubleTime) parts.push(`${h(t.doubleTime)} double time (2x)`);
  return parts.join(", ");
}

function weekOf(hoursPerDay: number[]): Punch[] {
  return hoursPerDay.flatMap((hrs, i) => (hrs > 0 ? day(addDays(EX_WEEK, i), hrs) : []));
}

function mealText(c: MealCheck): string {
  if (c.waived) return "no premium — the waiver covers it";
  if (c.premium && c.issue) return `1 meal premium hour (${MEAL_ISSUE_LABELS[c.issue].toLowerCase()})`;
  return "no premium";
}

const NO_WAIVER = { sixHour: false, secondMeal: false };

// ---------------------------------------------------------------------------

export function buildRules(): RuleSection[] {
  seq = 0;
  const first = payPeriodFor(PAY_PERIOD_ANCHOR);
  const holiday = payPeriodFor("2026-12-20");

  const tenHour = run(day(EX_WEEK, 10));
  const thirteenHour = run(day(EX_WEEK, 13));
  const fiveNines = run(weekOf([0, 9, 9, 9, 9, 9, 0]));
  const sixEights = run(weekOf([0, 8, 8, 8, 8, 8, 8]));
  const sevenTens = run(weekOf([10, 8, 8, 8, 8, 8, 10]));
  const exemptLong = run(day(EX_WEEK, 11), "exempt");

  const partial = parseSelfRequest({ start: "2026-11-02", mode: "partial", hours: String(MIN_PARTIAL_HOURS) }, "2026-11-01");
  const partialDays = partial.ok ? partial.value.ptoDays : NaN;
  const threeDay = deductionDays({ kind: "pto", status: "approved", balance_tracked: true, pto_days: null, start_date: "2026-11-02", end_date: "2026-11-04" });

  return [
    {
      id: "pay-calendar",
      title: "Pay calendar",
      status: "live",
      rules: [
        {
          text: `Biweekly pay periods of ${PAY_PERIOD_DAYS} days, Sunday to Saturday, matching the schedule weeks. The workweek for weekly overtime is Sunday 12:00 am to Saturday 11:59 pm Pacific.`,
          example: `First period: ${first.start} – ${first.end}, paid ${first.payDate}.`,
        },
        {
          text: "Payday is the Friday 6 days after the period ends. If that Friday is a Federal Reserve holiday, payday is the Thursday before.",
          example: `Period ${holiday.start} – ${holiday.end} would pay on Fri ${addDays(holiday.end, 6)} (New Year's Day), so it pays Thu ${holiday.payDate}.`,
          why: "Labor Code §204(d): wages for a biweekly period are due within 7 calendar days of its close.",
        },
      ],
    },
    {
      id: "punching",
      title: "Clocking in and out",
      status: "live",
      rules: [
        {
          text: "Everyone, exempt or not, clocks in, starts and ends lunch, and clocks out in My Time on their own phone or computer. The time comes from the server, never the device. A second identical tap within " +
            `${DUPLICATE_WINDOW_SECONDS} seconds is ignored.`,
        },
        {
          text: "Each punch is checked against the clinic's approved networks or geofence. A failed check never blocks the punch: the employee confirms \"Working off-site\" with a note and the punch waits for an approver.",
        },
        {
          text: "Punches are never edited or deleted. Fixes are separate, signed records (add a punch, or void one) with a reason; employees can ask for one within " +
            `${CORRECTION_WINDOW_DAYS} days.`,
          why: "Labor Code §1174(d) and §226: accurate time records, with the original kept.",
        },
        {
          text: "No rounding. Hours, meals and premiums use the exact minutes punched.",
          why: "California courts reject rounding of meal-period punches (Donohue v. AMN Services, 2021).",
        },
      ],
    },
    {
      id: "overtime",
      title: "Overtime",
      status: "live",
      intro: "Non-exempt employees only. A workday belongs to the date its first clock-in falls on (an overnight shift counts on the day it started).",
      rules: [
        {
          text: `Over ${h(DAILY_OT_AFTER)} in a workday is overtime at 1.5x; over ${h(DAILY_DT_AFTER)} is double time at 2x.`,
          example: `A 10-hour day → ${totalsText(tenHour)}. A 13-hour day → ${totalsText(thirteenHour)}.`,
          why: "Labor Code §510(a).",
        },
        {
          text: `Regular hours over ${h(WEEKLY_OT_AFTER)} in a workweek are overtime at 1.5x. Hours already paid as daily overtime are not counted again.`,
          example: `Five 9-hour days → ${totalsText(fiveNines)}. Six 8-hour days → ${totalsText(sixEights)}.`,
          why: "Labor Code §510(a).",
        },
        {
          text: `On the 7th consecutive workday of a workweek, the first ${h(SEVENTH_DAY_DT_AFTER)} are overtime at 1.5x and anything over is double time.`,
          example: `Seven days in one week (10 h Sunday, 8 h Monday–Friday, 10 h Saturday) → ${totalsText(sevenTens)} for the week.`,
          why: "Labor Code §510(a).",
        },
        {
          text: "Exempt employees punch the same way, but only their hours are reported — no overtime and no meal premiums.",
          example: `An exempt 11-hour day → ${h(exemptLong.worked)} worked, ${h(exemptLong.overtime)} overtime.`,
        },
      ],
    },
    {
      id: "meals",
      title: "Meal periods",
      status: "live",
      intro: "Non-exempt employees only. A meal is a punched lunch of at least 30 minutes. At most one meal premium hour per workday.",
      rules: [
        {
          text: `A workday over ${h(MEAL_REQUIRED_OVER)} needs a ${MEAL_MIN_MINUTES}-minute meal that starts by the end of the ${FIRST_MEAL_BY / 60}th hour of work. Missing, late or short → one premium hour at the regular rate.`,
          example: `5.5 h worked, no lunch → ${mealText(checkMeals(330, [], NO_WAIVER))}. 7 h with a 30-minute lunch after 5.5 h → ${mealText(checkMeals(420, [{ workedBefore: 330, minutes: 30 }], NO_WAIVER))}. 7 h with a 20-minute lunch after 4 h → ${mealText(checkMeals(420, [{ workedBefore: 240, minutes: 20 }], NO_WAIVER))}.`,
          why: "Labor Code §512(a) and §226.7.",
        },
        {
          text: `A workday over ${h(SECOND_MEAL_REQUIRED_OVER)} needs a second ${MEAL_MIN_MINUTES}-minute meal starting by the end of the ${SECOND_MEAL_BY / 60}th hour.`,
          example: `11 h worked with one lunch, no waiver → ${mealText(checkMeals(660, [{ workedBefore: 240, minutes: 30 }], NO_WAIVER))}.`,
          why: "Labor Code §512(a).",
        },
        {
          text: `Waivers are voluntary, e-signed in My Time, and can be revoked at any time. "${MEAL_WAIVER_LABELS.six_hour}" excuses the meal on a day of ${h(SIX_HOUR_WAIVER_MAX)} or less. "${MEAL_WAIVER_LABELS.second_meal}" excuses the second meal on a day of ${h(SECOND_MEAL_WAIVER_MAX)} or less when the first meal was taken. A day is judged by the waiver in force when it started; revoking never changes past days.`,
          example: `5.5 h, no lunch, 6-hour waiver signed → ${mealText(checkMeals(330, [], { sixHour: true, secondMeal: false }))}. 11 h, one lunch, second-meal waiver signed → ${mealText(checkMeals(660, [{ workedBefore: 240, minutes: 30 }], { sixHour: false, secondMeal: true }))}.`,
          why: "Labor Code §512(a); waivers must be mutual and voluntary.",
        },
      ],
    },
    {
      id: "approval",
      title: "Approval, lock and export",
      status: "live",
      rules: [
        {
          text: "Owner, Admin, Executive and HR / Manager approve timecards (Scheduling ▸ Payroll). Nobody approves their own. A timecard with a missing punch or an unapproved off-site punch can't be approved. If hours change after approval, the approval goes stale and must be given again.",
        },
        {
          text: "A period can be locked once it has ended and every timecard is approved. While locked, no correction can be added for a day inside it; only an Owner or Admin can reopen it, with a reason.",
        },
        {
          text: "The export is built only from the approved snapshots. Every export is logged with who, when, the totals and a fingerprint (SHA-256) of the file. The ADP RUN file layout is added once its header row and pay codes are confirmed.",
        },
      ],
    },
    {
      id: "pto",
      title: "PTO — requests and balance",
      status: "live",
      intro: "PTO covers both sick time and vacation in one balance, and is the company's California paid sick leave.",
      rules: [
        {
          text: `PTO is counted in days; 1 day = ${PTO_DAY_HOURS} hours for payroll. Planned time off is whole days. When PTO is used as sick time it can be taken in blocks as small as ${MIN_PARTIAL_HOURS} hours.`,
          example: `${MIN_PARTIAL_HOURS} hours of sick time → ${partialDays} day (${formatDays(partialDays)}).`,
          why: "Labor Code §246: paid sick leave may be used in increments of no less than 2 hours.",
        },
        {
          text: `Employees request PTO in My Time and are never asked for a reason. Sick time can be entered afterwards, up to ${PTO_BACKDATE_DAYS} days back.`,
          why: "Labor Code §246.5: an employer may not deny the use of accrued paid sick leave; asking no reason keeps every request usable as sick time.",
        },
        {
          text: "Ops keeps the balance (HR profile ▸ Paid Time Off). Approving a paid request takes its days off immediately; denying, reopening or deleting it gives them back. Unpaid requests never touch the balance. An approver can approve with 0 days when the time was already counted. Every change is recorded.",
          example: `A 3-day request (Mon–Wed) approved as paid PTO → ${formatDays(threeDay)} off the balance.`,
        },
      ],
    },
    {
      id: "pto-annual",
      title: "PTO — yearly cycle and payouts",
      status: "policy",
      intro: "The agreed rules. Until the automatic Jan 1 job is built, HR applies them by hand.",
      rules: [
        {
          text: "Calendar-year PTO: every Jan 1 the balance resets to the year's allotment. Unused PTO is paid out at the exact Dec 31 balance, on the paycheck for the pay period that contains Dec 31 — nothing is forfeited.",
          example: `Dec 31, 2026 falls in ${payPeriodFor("2026-12-31").start} – ${payPeriodFor("2026-12-31").end}, so the payout is on ${payPeriodFor("2026-12-31").payDate}.`,
          why: "Labor Code §227.3: vested vacation / PTO can't be forfeited.",
        },
        {
          text: `+${TENURE_STEP_DAYS} days a year after each 2nd, 4th, 6th … hire anniversary, starting the Jan 1 after it. No back-dated true-up.`,
          example: `Hired 2024-03-15 with 6 days → 2nd anniversary 2026-03-15 → ${allotmentFor(6, "2024-03-15", 2027)} days from Jan 1, 2027.`,
        },
        {
          text: `In the hire year the allotment is prorated by the days left in the year, rounded up to whole days, and never below ${PTO_SICK_FLOOR_DAYS} days for PTO-eligible staff.`,
          example: `Hired 2026-07-01 with 6 days a year → 6 × 184 / 365 = 3.02 → 4 → raised to ${firstYearGrant(6, "2026-07-01")} days.`,
          why: "Labor Code §246 (SB 616): front-loaded sick leave is at least 5 days / 40 hours a year.",
        },
        {
          text: "At separation, PTO vests pro rata for the days employed this year; the payout is vested days minus days taken, on California's final-pay deadline. A negative result is never deducted from final pay without a signed advance authorization.",
          example: `Allotment 8, leaves 2026-06-30 having taken 2 days → vested ${vestedDays(8, "2026-06-30")} → payout ${separationPayoutDays(8, "2026-06-30", 2)} days.`,
          why: "Labor Code §227.3 (vesting) and §§201–202 (final pay: at once if discharged; within 72 hours of a quit without notice).",
        },
      ],
    },
    {
      id: "retention",
      title: "Record keeping",
      status: "live",
      rules: [
        {
          text: "Punches, corrections, timecard approvals, exports and PTO changes are kept for 4 years after the pay period ends. Nothing deletes them.",
          why: "Labor Code §1174(d) requires 3 years; 4 years covers the UCL limit (Bus. & Prof. Code §17208).",
        },
      ],
    },
  ];
}

/** audit_log action recording a Payroll / HR sign-off (metadata.version). */
export const RULES_SIGNOFF_ACTION = "timekeeping_rules.signed_off";

/** Short fingerprint of the rules text; any change to a rule or example changes it. */
export function rulesVersion(sections: readonly RuleSection[]): string {
  return createHash("sha256").update(JSON.stringify(sections)).digest("hex").slice(0, 12);
}
