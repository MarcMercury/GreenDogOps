// Domain types and helpers for the Calendar module.
//
// A CalendarItem is the unified shape rendered on the page. It is produced from
// two kinds of source (see 0075_calendar_module.sql):
//   * physical  — rows in greendogops.calendar_event (source = google | custom)
//   * projected — read-time rows built from CE events, interviews, time-off.
//
// `category` drives colour + the legend and is the single knob the UI keys on.

export type CalendarSource = "google" | "custom" | "ce" | "interview" | "time_off";

export type CalendarCategory =
  | "google"
  | "general"
  | "ce"
  | "interview"
  | "time_off";

export type CalendarStatus = "confirmed" | "tentative" | "cancelled";

/** Unified event shape consumed by the calendar UI. Times are ISO strings. */
export interface CalendarItem {
  /** Stable, source-qualified id, e.g. "custom:<uuid>" or "interview:<uuid>". */
  id: string;
  source: CalendarSource;
  category: CalendarCategory;
  title: string;
  description: string | null;
  location: string | null;
  /** ISO 8601 start. */
  start: string;
  /** ISO 8601 end (exclusive for all-day, per FullCalendar convention). */
  end: string | null;
  allDay: boolean;
  status: CalendarStatus;
  /** Deep-link into the owning module, e.g. "/ats" or "/crm/ce". */
  href: string | null;
  /** True only for `custom` events, which the Calendar page can edit/delete. */
  editable: boolean;
}

export const CATEGORY_LABELS: Record<CalendarCategory, string> = {
  google: "Google Calendar",
  general: "Custom",
  ce: "CE Event",
  interview: "Interview",
  time_off: "Time Off",
};

/** Hex colours fed to FullCalendar for event backgrounds. */
export const CATEGORY_COLORS: Record<CalendarCategory, string> = {
  google: "#4285F4", // Google blue
  general: "#0f766e", // teal-700 (matches app accent)
  ce: "#7c3aed", // violet-600
  interview: "#d97706", // amber-600
  time_off: "#64748b", // slate-500
};

/** Tailwind chip classes used by the legend / lists (server-safe strings). */
export const CATEGORY_TONE: Record<CalendarCategory, string> = {
  google: "bg-blue-100 text-blue-800",
  general: "bg-teal-100 text-teal-800",
  ce: "bg-violet-100 text-violet-800",
  interview: "bg-amber-100 text-amber-800",
  time_off: "bg-slate-100 text-slate-600",
};

/** Source-qualified id used everywhere a CalendarItem needs a stable key. */
export function itemId(source: CalendarSource, rawId: string): string {
  return `${source}:${rawId}`;
}

/** Combine a `date` column and optional `HH:MM`-ish time into an ISO string. */
export function combineDateTime(
  date: string,
  time: string | null,
): { iso: string; allDay: boolean } {
  if (!time) return { iso: `${date}T00:00:00`, allDay: true };
  const parsed = parseClockTime(time);
  if (!parsed) return { iso: `${date}T00:00:00`, allDay: true };
  return { iso: `${date}T${parsed}`, allDay: false };
}

/** Normalise loose time strings ("9:00 AM", "09:00", "9") to "HH:MM:SS". */
export function parseClockTime(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3];
  if (mer === "pm" && hour < 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;
  if (hour > 23 || min > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
}
