import "server-only";
import { calendarsFromEnv, type GoogleCalendarConfig } from "./calendar-env";

export type { GoogleCalendarConfig };

/**
 * The set of Google calendars to sync, derived from env so calendars can be
 * added without a code change. Only calendars with a configured ID are returned.
 */
export function getGoogleCalendars(): GoogleCalendarConfig[] {
  return calendarsFromEnv(process.env);
}
