// Pay calendar (go-live plan D7) — pure. Biweekly, Sunday–Saturday, anchored
// at the period Sun 2026-09-20 – Sat 2026-10-03 (paid Fri 2026-10-09). Pay
// date = the Friday 6 days after the period ends; if that Friday is a Federal
// Reserve holiday, the business day before.

import { addDays, daysBetween } from "../worklist/dates";

export const PAY_PERIOD_ANCHOR = "2026-09-20";
export const PAY_PERIOD_DAYS = 14;

export interface PayPeriod {
  start: string;
  end: string;
  payDate: string;
}

// Fixed-date Fed holidays are the only ones that can land on a Friday; the
// Fed does not close on the Friday before a Saturday holiday.
const FIXED_FED_HOLIDAYS = new Set(["01-01", "06-19", "07-04", "11-11", "12-25"]);

export function payDateFor(periodEnd: string): string {
  const friday = addDays(periodEnd, 6);
  return FIXED_FED_HOLIDAYS.has(friday.slice(5)) ? addDays(friday, -1) : friday;
}

/** The pay period containing `date` (YYYY-MM-DD). */
export function payPeriodFor(date: string): PayPeriod {
  const offset = daysBetween(PAY_PERIOD_ANCHOR, date);
  const index = Math.floor(offset / PAY_PERIOD_DAYS);
  const start = addDays(PAY_PERIOD_ANCHOR, index * PAY_PERIOD_DAYS);
  const end = addDays(start, PAY_PERIOD_DAYS - 1);
  return { start, end, payDate: payDateFor(end) };
}

/** The period containing `date` and the `count - 1` before it, newest first. */
export function recentPayPeriods(date: string, count: number): PayPeriod[] {
  const out: PayPeriod[] = [];
  let p = payPeriodFor(date);
  for (let i = 0; i < count; i++) {
    out.push(p);
    p = payPeriodFor(addDays(p.start, -1));
  }
  return out;
}
