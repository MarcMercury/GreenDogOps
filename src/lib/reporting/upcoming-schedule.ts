// ---------------------------------------------------------------------------
// When the upcoming-appointments Slack report posts. Pure functions (no
// server-only imports) so the schedule can be unit-tested; the route lives in
// src/app/api/agents/reporting/slack-upcoming.
//
// The report posts Monday, Wednesday and Friday at 9 AM Pacific — well after
// the 5:00–5:30 AM Pacific ezyVet Agenda look-ahead pull it reads from.
// Vercel Cron is UTC-only with no DST awareness, so vercel.json fires at both
// 16:00 UTC (9 AM PDT) and 17:00 UTC (9 AM PST) and only the run that lands at
// 9 AM Pacific posts.
// ---------------------------------------------------------------------------

/** Pacific weekdays the report posts on (0 = Sunday). */
export const UPCOMING_POST_WEEKDAYS: readonly number[] = [1, 3, 5];

/** Pacific hour (0–23) the report posts at. */
export const UPCOMING_POST_HOUR = 9;

/** Weekday (0 = Sunday) and hour (0–23) of `now` in America/Los_Angeles. */
export function pacificWeekdayHour(now: Date): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
  return { weekday, hour };
}

/** True when `now` is a scheduled posting slot (Mon/Wed/Fri, 9 AM Pacific). */
export function isUpcomingPostSlot(now: Date): boolean {
  const { weekday, hour } = pacificWeekdayHour(now);
  return hour === UPCOMING_POST_HOUR && UPCOMING_POST_WEEKDAYS.includes(weekday);
}

/**
 * Warning line for the report when the newest Agenda pull is not from today,
 * i.e. the morning upload failed or has not finished. Null when it is fresh.
 */
export function staleAgendaWarning(bookedAsOf: string | null, today: string): string | null {
  if (bookedAsOf === today) return null;
  if (!bookedAsOf) {
    return "⚠️ _No ezyVet Agenda pull found — booked counts may be missing._";
  }
  const asOf = new Date(`${bookedAsOf}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `⚠️ _This morning's ezyVet Agenda pull hasn't landed — booked counts are from ${asOf}._`;
}
