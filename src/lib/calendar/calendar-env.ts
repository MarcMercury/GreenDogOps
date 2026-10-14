import type { CalendarCategory } from "./types";

/**
 * A Google calendar we mirror into greendogops.calendar_event. Each mirrored
 * calendar maps to a single UI `category` (colour / legend bucket) so events
 * from, e.g., the interviews calendar render distinctly from the general
 * company calendar.
 */
export interface GoogleCalendarConfig {
  id: string;
  /** Category stored on synced rows and used for colour/legend. */
  category: Extract<CalendarCategory, "google" | "interview">;
  /** Human label for logs / sync status. */
  label: string;
}

/** Env var → how that calendar is labelled and coloured. Order is sync order. */
const CALENDAR_ENV: { env: string; category: GoogleCalendarConfig["category"]; label: string }[] = [
  { env: "GOOGLE_CALENDAR_ID", category: "google", label: "Company Calendar" },
  { env: "GOOGLE_COMPANY_CALENDAR_ID", category: "google", label: "Green Dog Company Calendar" },
  { env: "GOOGLE_DENTAL_CALENDAR_ID", category: "google", label: "Green Dog Dental Calendar" },
  { env: "GOOGLE_INTERVIEW_CALENDAR_ID", category: "interview", label: "Interviews" },
];

/**
 * The calendars to sync from the given env. Unset ones are skipped, and a
 * calendar ID set in two variables is synced once (the first one wins), since
 * each sync prunes rows for its calendar ID.
 */
export function calendarsFromEnv(env: Record<string, string | undefined>): GoogleCalendarConfig[] {
  const seen = new Set<string>();
  const calendars: GoogleCalendarConfig[] = [];
  for (const { env: key, category, label } of CALENDAR_ENV) {
    const id = env[key]?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    calendars.push({ id, category, label });
  }
  return calendars;
}
