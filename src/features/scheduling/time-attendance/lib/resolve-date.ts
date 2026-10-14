import { addDays, isIsoDate } from "@/lib/worklist/dates";

/** How far ahead the dashboard will open: published weeks run about this far out. */
const MAX_DAYS_AHEAD = 14;

/**
 * The day to show: the `?date=` value when it is a real calendar date no more
 * than two weeks out, otherwise today. Anything else falls back silently, so a
 * stale or mistyped link lands on today rather than an error.
 */
export function resolveDate(param: string | undefined, today: string): string {
  return param && isIsoDate(param) && param <= addDays(today, MAX_DAYS_AHEAD) ? param : today;
}
