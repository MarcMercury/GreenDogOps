import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getGoogleCalendars } from "@/lib/calendar/config";
import {
  type CalendarItem,
  type CalendarCategory,
  combineDateTime,
  itemId,
} from "@/lib/calendar/types";

const PERSON_COLS =
  "id, first_name, last_name, preferred_name, grid_name, full_name";

type PersonName = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  grid_name: string | null;
  full_name: string | null;
};

function displayName(p: PersonName | null | undefined): string {
  if (!p) return "Unknown";
  return (
    p.full_name ||
    p.grid_name ||
    [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" ") ||
    "Unknown"
  );
}

/** Supabase infers to-one embeds as arrays; normalise to a single record. */
function firstPerson(p: PersonName | PersonName[] | null): PersonName | null {
  return Array.isArray(p) ? (p[0] ?? null) : p;
}

/** Default window loaded up front: recent past through the next year. */
export function defaultRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - 3);
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Physical rows: calendar_event (google + custom).
// ---------------------------------------------------------------------------
type CalendarEventRow = {
  id: string;
  source: "google" | "custom";
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  category: string | null;
};

/** Colour bucket for a stored calendar_event row. */
function rowCategory(r: CalendarEventRow): CalendarCategory {
  if (r.source === "custom") return "general";
  // Google rows carry the category written by the sync job (google | interview).
  return r.category === "interview" ? "interview" : "google";
}

async function getStoredEvents(
  start: string,
  end: string,
): Promise<CalendarItem[]> {
  const supabase = await createClient();
  const { data } = await fetchAllRows<CalendarEventRow>((from, to) =>
    supabase
      .from("calendar_event")
      .select(
        "id, source, title, description, location, starts_at, ends_at, all_day, status, category",
      )
      .neq("status", "cancelled")
      .gte("starts_at", `${start}T00:00:00`)
      .lte("starts_at", `${end}T23:59:59`)
      .order("starts_at", { ascending: true })
      .range(from, to),
  );
  return (data ?? []).map((r) => ({
    id: itemId(r.source, r.id),
    source: r.source,
    category: rowCategory(r),
    title: r.title,
    description: r.description,
    location: r.location,
    start: r.starts_at,
    end: r.ends_at,
    allDay: r.all_day,
    status: r.status,
    href: null,
    editable: r.source === "custom",
  }));
}

// ---------------------------------------------------------------------------
// Projected: CE events (crm_ce_event.event_date).
// ---------------------------------------------------------------------------
type CeEventRow = {
  id: string;
  name: string;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  subject: string | null;
  status: string | null;
};

async function getCeEvents(
  start: string,
  end: string,
): Promise<CalendarItem[]> {
  const supabase = await createClient();
  const { data } = await fetchAllRows<CeEventRow>((from, to) =>
    supabase
      .from("crm_ce_event")
      .select("id, name, event_date, start_time, end_time, location, subject, status")
      .not("event_date", "is", null)
      .neq("status", "cancelled")
      .gte("event_date", start)
      .lte("event_date", end)
      .range(from, to),
  );
  return (data ?? []).map((r) => {
    const { iso, allDay } = combineDateTime(r.event_date!, r.start_time);
    const endTime = r.end_time
      ? combineDateTime(r.event_date!, r.end_time).iso
      : null;
    return {
      id: itemId("ce", r.id),
      source: "ce" as const,
      category: "ce" as const,
      title: `CE: ${r.name}`,
      description: r.subject,
      location: r.location,
      start: iso,
      end: endTime,
      allDay,
      status: "confirmed" as const,
      href: "/crm/ce",
      editable: false,
    };
  });
}

// ---------------------------------------------------------------------------
// Projected: ATS interviews (person_interview.interview_date).
// ---------------------------------------------------------------------------
type InterviewRow = {
  id: string;
  interview_date: string | null;
  interview_type: string | null;
  location: string | null;
  status: string | null;
  person: PersonName | PersonName[] | null;
};

async function getInterviews(
  start: string,
  end: string,
): Promise<CalendarItem[]> {
  const supabase = await createClient();
  const { data } = await fetchAllRows<InterviewRow>((from, to) =>
    supabase
      .from("person_interview")
      .select(`id, interview_date, interview_type, location, status, person:person_id (${PERSON_COLS})`)
      .not("interview_date", "is", null)
      .neq("status", "cancelled")
      .gte("interview_date", start)
      .lte("interview_date", end)
      .range(from, to),
  );
  return (data ?? []).map((r) => {
    const kind = r.interview_type?.replace(/_/g, " ") ?? "interview";
    return {
      id: itemId("interview", r.id),
      source: "interview" as const,
      category: "interview" as const,
      title: `Interview: ${displayName(firstPerson(r.person))}`,
      description: kind,
      location: r.location,
      start: `${r.interview_date}T00:00:00`,
      end: null,
      allDay: true,
      status: "confirmed" as const,
      href: "/ats",
      editable: false,
    };
  });
}

/**
 * All calendar items in [start, end], merging physical calendar_event rows with
 * read-time projections of CE events and interviews.
 */
export async function getCalendarItems(
  start: string,
  end: string,
): Promise<CalendarItem[]> {
  const [stored, ce, interviews] = await Promise.all([
    getStoredEvents(start, end),
    getCeEvents(start, end),
    getInterviews(start, end),
  ]);
  return [...stored, ...ce, ...interviews];
}

export interface GoogleSyncStatus {
  lastSyncedAt: string | null;
  status: string | null;
  error: string | null;
}

/**
 * Combined Google Calendar sync status across every configured calendar, or
 * null if none are configured / none have synced. Surfaces an error if any
 * calendar's last run failed and reports the most recent sync time.
 */
export async function getGoogleSyncStatus(): Promise<GoogleSyncStatus | null> {
  const calendars = getGoogleCalendars();
  if (calendars.length === 0) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_sync_state")
    .select("google_calendar_id, last_synced_at, last_status, last_error")
    .in(
      "google_calendar_id",
      calendars.map((c) => c.id),
    );
  if (!data || data.length === 0) return null;

  const labelById = new Map(calendars.map((c) => [c.id, c.label]));
  let lastSyncedAt: string | null = null;
  let anyError = false;
  const errors: string[] = [];

  for (const row of data) {
    const synced = (row.last_synced_at as string | null) ?? null;
    if (synced && (!lastSyncedAt || synced > lastSyncedAt)) lastSyncedAt = synced;
    if ((row.last_status as string | null) === "error") {
      anyError = true;
      const label = labelById.get(row.google_calendar_id as string) ?? "Calendar";
      errors.push(`${label}: ${(row.last_error as string | null) ?? "sync failed"}`);
    }
  }

  return {
    lastSyncedAt,
    status: anyError ? "error" : "ok",
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}
