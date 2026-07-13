import "server-only";
import type { CalendarCategory } from "./types";

/**
 * A Google calendar we mirror into greendogops.calendar_event. Each mirrored
 * calendar maps to a single UI `category` (colour / legend bucket) so events
 * from, e.g., the interviews calendar render distinctly from the general
 * company calendar. Env-driven so calendars can be added without a deploy.
 */
export interface GoogleCalendarConfig {
  id: string;
  /** Category stored on synced rows and used for colour/legend. */
  category: Extract<CalendarCategory, "google" | "interview">;
  /** Human label for logs / sync status. */
  label: string;
}

/**
 * The set of Google calendars to sync, derived from env. Only calendars with a
 * configured ID are returned, so an unset interview calendar is simply skipped.
 */
export function getGoogleCalendars(): GoogleCalendarConfig[] {
  const calendars: GoogleCalendarConfig[] = [];

  const company = process.env.GOOGLE_CALENDAR_ID?.trim();
  if (company) {
    calendars.push({ id: company, category: "google", label: "Company Calendar" });
  }

  const companyShared = process.env.GOOGLE_COMPANY_CALENDAR_ID?.trim();
  if (companyShared) {
    calendars.push({
      id: companyShared,
      category: "google",
      label: "Green Dog Company Calendar",
    });
  }

  const interviews = process.env.GOOGLE_INTERVIEW_CALENDAR_ID?.trim();
  if (interviews) {
    calendars.push({ id: interviews, category: "interview", label: "Interviews" });
  }

  return calendars;
}
