// Publishing discipline (go-live plan D5, checklist item 9) — pure.
//
// The Ops grid is the live schedule: My Schedule shows published weeks only,
// and a clock-in is matched to a published shift. So:
//   - the current week must be published (overdue otherwise);
//   - next week must be published by Thursday (due from then on);
//   - publishing a week with shifts that have no start/end time needs an
//     explicit confirmation, because lateness can't be graded on them.

import { addDays, weekdayOf } from "../worklist/dates";

/** Next week is due from this weekday (0 = Sunday … 4 = Thursday). */
export const PUBLISH_DUE_WEEKDAY = 4;
/** Reminders go out from this hour (clinic time). */
export const PUBLISH_REMINDER_HOUR = 10;

export type PublishUrgency = "overdue" | "due" | null;

/** Sunday of the week containing `date` (YYYY-MM-DD). */
export function weekStartOf(date: string): string {
  return addDays(date, -weekdayOf(date));
}

/**
 * How urgent publishing this week is, given today's date in clinic time.
 * Published weeks and templates are never urgent.
 */
export function publishUrgency(weekStart: string, status: string, today: string): PublishUrgency {
  if (status === "published") return null;
  const thisWeek = weekStartOf(today);
  if (weekStart <= thisWeek && addDays(weekStart, 6) >= today) return "overdue";
  if (weekStart === addDays(thisWeek, 7) && weekdayOf(today) >= PUBLISH_DUE_WEEKDAY) return "due";
  return null;
}

/** The weeks a reminder should go out for today (current week, and next week from Thursday). */
export function weeksNeedingReminder(today: string): string[] {
  const thisWeek = weekStartOf(today);
  return weekdayOf(today) >= PUBLISH_DUE_WEEKDAY ? [thisWeek, addDays(thisWeek, 7)] : [thisWeek];
}

export interface ShiftForCheck {
  work_date: string;
  person_name: string;
  line_label: string | null;
  start_time: string | null;
  end_time: string | null;
}

/** Shifts missing a start or end time, as short lines for a confirmation. */
export function untimedShifts(rows: readonly ShiftForCheck[]): string[] {
  return rows
    .filter((r) => !r.start_time || !r.end_time)
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.person_name.localeCompare(b.person_name))
    .map((r) => `${r.work_date} · ${r.person_name}${r.line_label ? ` · ${r.line_label}` : ""}`);
}
