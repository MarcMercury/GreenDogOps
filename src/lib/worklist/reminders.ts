// Recurring reminders: when a rule falls due, and what the dashboard shows.
// Pure functions — the rows come from greendogops.reminder_rule (migration 0230).

import type { AppRole, AppUser, ModuleKey } from "../auth/permissions";
import { canAccessModule } from "../auth/permissions";
import { addDays, daysInMonth, parseIsoDate, toIsoDate, weekdayOf } from "./dates";

export const REMINDER_CADENCES = [
  "weekly",
  "monthly_day",
  "monthly_weekday",
  "monthly_business_day",
  "yearly",
] as const;
export type ReminderCadence = (typeof REMINDER_CADENCES)[number];

export interface ReminderSchedule {
  cadence: ReminderCadence;
  /** 0 = Sunday … 6 = Saturday. weekly: one or more; monthly_weekday: exactly one. */
  weekdays: number[];
  /** monthly_day / yearly: 1–31 (clamped to short months) or -1 = last day.
   *  monthly_business_day: Nth Mon–Fri (1–23) or -1 = last Mon–Fri. */
  month_day: number | null;
  /** monthly_weekday: 1–5 or -1 = last. */
  week_of_month: number | null;
  /** yearly: 1–12. */
  month: number | null;
  /** No occurrence before this date. */
  starts_on: string;
}

export interface ReminderRule extends ReminderSchedule {
  id: string;
  title: string;
  details: string | null;
  href: string | null;
  module: string | null;
  audience_roles: string[];
  owner_user_id: string | null;
  is_active: boolean;
  sort_order: number;
}

/** Why a schedule is invalid, or null. Mirrors reminder_rule_cadence_fields. */
export function scheduleError(s: Omit<ReminderSchedule, "starts_on">): string | null {
  const days = s.weekdays ?? [];
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Pick valid days of the week.";
  switch (s.cadence) {
    case "weekly":
      return days.length > 0 ? null : "Pick at least one day of the week.";
    case "monthly_day":
      return validMonthDay(s.month_day, 31) ? null : "Pick a day of the month.";
    case "monthly_business_day":
      return validMonthDay(s.month_day, 23) ? null : "Pick which business day (1st–23rd, or last).";
    case "monthly_weekday":
      if (days.length !== 1) return "Pick one day of the week.";
      return s.week_of_month === -1 || (s.week_of_month !== null && s.week_of_month >= 1 && s.week_of_month <= 5)
        ? null
        : "Pick which week of the month.";
    case "yearly":
      if (s.month === null || s.month < 1 || s.month > 12) return "Pick a month.";
      return validMonthDay(s.month_day, 31) ? null : "Pick a day of the month.";
    default:
      return "Unknown repeat type.";
  }
}

function validMonthDay(v: number | null, max: number): boolean {
  return v === -1 || (v !== null && Number.isInteger(v) && v >= 1 && v <= max);
}

function ymd(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function isoFor(y: number, m: number, d: number): string {
  return toIsoDate(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** The single date a monthly/yearly rule falls on in a given month, or null. */
function dateInMonth(s: ReminderSchedule, y: number, m: number): string | null {
  const dim = daysInMonth(y, m);
  switch (s.cadence) {
    case "monthly_day":
    case "yearly": {
      if (s.cadence === "yearly" && s.month !== m) return null;
      const d = s.month_day === -1 ? dim : Math.min(s.month_day ?? 1, dim);
      return isoFor(y, m, d);
    }
    case "monthly_business_day": {
      const business: number[] = [];
      for (let d = 1; d <= dim; d++) {
        const wd = parseIsoDate(isoFor(y, m, d)).getUTCDay();
        if (wd >= 1 && wd <= 5) business.push(d);
      }
      const n = s.month_day ?? 1;
      const d = n === -1 ? business[business.length - 1] : business[n - 1];
      return d ? isoFor(y, m, d) : null;
    }
    case "monthly_weekday": {
      const wd = s.weekdays[0];
      const matches: number[] = [];
      for (let d = 1; d <= dim; d++) {
        if (parseIsoDate(isoFor(y, m, d)).getUTCDay() === wd) matches.push(d);
      }
      const n = s.week_of_month ?? 1;
      const d = n === -1 ? matches[matches.length - 1] : matches[n - 1];
      return d ? isoFor(y, m, d) : null;
    }
    default:
      return null;
  }
}

/** Does the rule fall on this date? */
export function occursOn(s: ReminderSchedule, date: string): boolean {
  if (date < s.starts_on) return false;
  if (s.cadence === "weekly") return s.weekdays.includes(weekdayOf(date));
  const { y, m } = ymd(date);
  return dateInMonth(s, y, m) === date;
}

const MAX_MONTHS = 14;

function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** Latest occurrence on or before `date`, or null (none since starts_on / within ~13 months). */
export function previousOccurrence(s: ReminderSchedule, date: string): string | null {
  if (date < s.starts_on) return null;
  if (s.cadence === "weekly") {
    let d = date;
    for (let i = 0; i < 7 && d >= s.starts_on; i++) {
      if (s.weekdays.includes(weekdayOf(d))) return d;
      d = addDays(d, -1);
    }
    return null;
  }
  const start = ymd(date);
  for (let i = 0; i <= MAX_MONTHS; i++) {
    const { y, m } = shiftMonth(start.y, start.m, -i);
    const candidate = dateInMonth(s, y, m);
    if (candidate && candidate <= date) return candidate >= s.starts_on ? candidate : null;
  }
  return null;
}

/** First occurrence strictly after `date`, or null. */
export function nextOccurrence(s: ReminderSchedule, date: string): string | null {
  const from = addDays(date < s.starts_on ? addDays(s.starts_on, -1) : date, 1);
  if (s.cadence === "weekly") {
    if (s.weekdays.length === 0) return null;
    let d = from;
    for (let i = 0; i < 7; i++) {
      if (s.weekdays.includes(weekdayOf(d))) return d;
      d = addDays(d, 1);
    }
    return null;
  }
  const start = ymd(from);
  for (let i = 0; i <= MAX_MONTHS; i++) {
    const { y, m } = shiftMonth(start.y, start.m, i);
    const candidate = dateInMonth(s, y, m);
    if (candidate && candidate >= from) return candidate;
  }
  return null;
}

export type ReminderStatus = "due" | "overdue" | "done";

export interface ReminderView {
  rule: ReminderRule;
  /** Most recent occurrence (today or earlier), if any. */
  occurrence: string | null;
  status: ReminderStatus | null;
  next: string | null;
}

/**
 * A reminder stays on the list from the day it falls due until it is marked
 * done or its next occurrence replaces it. `acked` holds the occurrence dates
 * this user has marked done.
 */
export function reminderView(rule: ReminderRule, today: string, acked: ReadonlySet<string>): ReminderView {
  const occurrence = previousOccurrence(rule, today);
  let status: ReminderStatus | null = null;
  if (occurrence) {
    status = acked.has(occurrence) ? "done" : occurrence === today ? "due" : "overdue";
  }
  return { rule, occurrence, status, next: nextOccurrence(rule, today) };
}

/** Is this rule for this user? Personal rules: owner only. Shared: role + module gate. */
export function reminderAppliesTo(rule: ReminderRule, user: AppUser): boolean {
  if (!rule.is_active || !user.is_active) return false;
  if (rule.owner_user_id) return rule.owner_user_id === user.id;
  if (rule.audience_roles.length > 0 && !rule.audience_roles.includes(user.role as AppRole)) return false;
  if (rule.module && !canAccessModule(user, rule.module as ModuleKey)) return false;
  return true;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  const suffix: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
  return `${n}${suffix[n % 10] ?? "th"}`;
}

/** "Every Monday", "Weekdays", "Last Friday of the month", … */
export function describeSchedule(s: Omit<ReminderSchedule, "starts_on">): string {
  switch (s.cadence) {
    case "weekly": {
      const days = [...s.weekdays].sort((a, b) => a - b);
      if (days.length === 7) return "Every day";
      if (days.length === 5 && days.join() === "1,2,3,4,5") return "Every weekday";
      if (days.length === 1) return `Every ${WEEKDAY_NAMES[days[0]]}`;
      return `Every ${days.map((d) => WEEKDAY_SHORT[d]).join(", ")}`;
    }
    case "monthly_day":
      return s.month_day === -1 ? "Last day of the month" : `Monthly on the ${ordinal(s.month_day ?? 1)}`;
    case "monthly_business_day":
      return s.month_day === -1
        ? "Last business day of the month"
        : `${ordinal(s.month_day ?? 1)} business day of the month`;
    case "monthly_weekday": {
      const which = s.week_of_month === -1 ? "Last" : ordinal(s.week_of_month ?? 1);
      return `${which} ${WEEKDAY_NAMES[s.weekdays[0] ?? 1]} of the month`;
    }
    case "yearly": {
      const month = MONTH_NAMES[(s.month ?? 1) - 1];
      return s.month_day === -1 ? `Yearly on the last day of ${month}` : `Yearly on ${month} ${s.month_day}`;
    }
    default:
      return "Custom";
  }
}
