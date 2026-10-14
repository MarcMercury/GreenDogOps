// PTO annual-cycle rules (plan §H, D8a–D8e) — pure. Used by the PTO &
// Timekeeping Rules page today, and by the Jan 1 / payout job when it is built
// (docs/agent/improvements.md), so the explanation and the behaviour share one
// definition.

import { daysBetween } from "../worklist/dates";

/** California paid-sick-leave front-load minimum (Labor Code §246, SB 616). */
export const PTO_SICK_FLOOR_DAYS = 5;
export const TENURE_STEP_DAYS = 2;
export const TENURE_STEP_EVERY_YEARS = 2;

export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/**
 * First-year grant for someone hired during `hireDate`'s year: the annual
 * allotment × days left in the year ÷ days in the year, rounded UP to whole
 * days, never below the sick-leave floor for PTO-eligible staff.
 */
export function firstYearGrant(annualAllotment: number, hireDate: string, ptoEligible = true): number {
  const year = Number(hireDate.slice(0, 4));
  const left = daysBetween(hireDate, `${year}-12-31`) + 1;
  const prorated = Math.ceil(Math.round(((annualAllotment * left) / daysInYear(year)) * 1e6) / 1e6);
  return ptoEligible ? Math.max(prorated, PTO_SICK_FLOOR_DAYS) : prorated;
}

/** Did a 2nd / 4th / 6th … hire anniversary fall in `year`? */
export function tenureStepIn(hireDate: string, year: number): boolean {
  const years = year - Number(hireDate.slice(0, 4));
  return years > 0 && years % TENURE_STEP_EVERY_YEARS === 0;
}

/** Allotment for `year`: last year's, +2 if a step anniversary fell last year (no true-up). */
export function allotmentFor(previousAllotment: number, hireDate: string, year: number): number {
  return previousAllotment + (tenureStepIn(hireDate, year - 1) ? TENURE_STEP_DAYS : 0);
}

/** The next step anniversary on or after `from` (YYYY-MM-DD). */
export function nextStepAnniversary(hireDate: string, from: string): string {
  const hireYear = Number(hireDate.slice(0, 4));
  let year = Math.max(Number(from.slice(0, 4)), hireYear + 1);
  for (;;) {
    if (tenureStepIn(hireDate, year)) {
      const md = hireDate.slice(5) === "02-29" && daysInYear(year) === 365 ? "02-28" : hireDate.slice(5);
      const date = `${year}-${md}`;
      if (date >= from) return date;
    }
    year += 1;
  }
}

/**
 * Days vested by `separationDate` (PTO vests as it's worked, Labor Code
 * §227.3): allotment × days employed this year ÷ days in the year.
 */
export function vestedDays(annualAllotment: number, separationDate: string, hireDate?: string | null): number {
  const year = Number(separationDate.slice(0, 4));
  const from = hireDate && hireDate.slice(0, 4) === String(year) ? hireDate : `${year}-01-01`;
  const employed = daysBetween(from, separationDate) + 1;
  return Math.round(((annualAllotment * employed) / daysInYear(year)) * 100) / 100;
}

/** Separation payout: vested − taken (a negative result is never deducted without a signed authorization). */
export function separationPayoutDays(annualAllotment: number, separationDate: string, takenDays: number, hireDate?: string | null): number {
  return Math.round((vestedDays(annualAllotment, separationDate, hireDate) - takenDays) * 100) / 100;
}
