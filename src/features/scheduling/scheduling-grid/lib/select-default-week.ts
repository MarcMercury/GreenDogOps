/**
 * Which week the grid opens on when the URL names none: the current week, or
 * the most recent week on/before today, falling back to the last entry of the
 * list if everything is in the future. Callers pass `weeks` newest-first (as
 * `getWeeks()` returns them), so that last entry is the earliest week built.
 */
export function selectDefaultWeek<T extends { week_start: string }>(
  weeks: T[],
  currentWeekStart: string,
): T | null {
  return (
    weeks.find((w) => w.week_start === currentWeekStart) ??
    weeks.find((w) => w.week_start <= currentWeekStart) ??
    weeks[weeks.length - 1] ??
    null
  );
}
