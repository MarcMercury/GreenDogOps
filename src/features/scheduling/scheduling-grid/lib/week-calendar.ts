import type { SchedWeek, ScheduleStatus } from "@/lib/schedule/types";

/** Weeks oldest → newest (`getWeeks()` returns newest first). */
export function sortWeeksAscending(weeks: SchedWeek[]): SchedWeek[] {
  return [...weeks].sort((a, b) => a.week_start.localeCompare(b.week_start));
}

/** Workflow status per `week_start`, for the calendar's status dots. */
export function weekStatusByStart(weeks: SchedWeek[]): Map<string, ScheduleStatus> {
  return new Map(weeks.map((w) => [w.week_start, w.status]));
}

/** Week id per `week_start`, to navigate from a calendar click. */
export function weekIdByStart(weeks: SchedWeek[]): Map<string, string> {
  return new Map(weeks.map((w) => [w.week_start, w.id]));
}

/** The weeks either side of the open one in the ascending list, for ‹ ›. */
export function neighborWeeks(
  ordered: SchedWeek[],
  selectedId: string | null,
): { prev: SchedWeek | null; next: SchedWeek | null } {
  const i = selectedId ? ordered.findIndex((w) => w.id === selectedId) : -1;
  return {
    prev: i > 0 ? ordered[i - 1] : null,
    next: i >= 0 && i < ordered.length - 1 ? ordered[i + 1] : null,
  };
}

/** The first of the month a `YYYY-MM-DD` week start falls in, as a local date (the calendar's `month`). */
export function calendarMonthFor(weekStart: string): Date {
  const [y, m] = weekStart.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

/** "October 2026" */
export function monthLabel(month: Date): string {
  return month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
