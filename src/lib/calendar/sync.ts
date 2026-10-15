import "server-only";
import type { calendar_v3 } from "@googleapis/calendar";
import { getCalendarClient } from "./google";
import { getGoogleCalendars, type GoogleCalendarConfig } from "./config";
import { partitionNewEvents } from "./dedupe";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/paginate";

// Rolling window we mirror. Recurring events are expanded (singleEvents) only
// within this window so an open-ended series can't explode into thousands of
// far-future rows.
const LOOKBACK_DAYS = 90;
const LOOKAHEAD_DAYS = 400;

/** Per-calendar sync outcome. */
export interface CalendarSyncResult {
  calendarId: string;
  label: string;
  ok: boolean;
  fetched: number;
  inserted: number;
  updated: number;
  removed: number;
  /** Events skipped because another calendar already mirrors them. */
  shared: number;
  error?: string;
}

/** Aggregate result across every mirrored calendar. */
export interface SyncResult {
  ok: boolean;
  fetched: number;
  inserted: number;
  updated: number;
  removed: number;
  windowStart: string;
  windowEnd: string;
  calendars: CalendarSyncResult[];
  error?: string;
}

type GoogleEvent = calendar_v3.Schema$Event;
type Db = ReturnType<typeof createAdminClient>;

/** Rows shaped for greendogops.calendar_event (google source). */
interface EventRow {
  source: "google";
  google_event_id: string;
  google_calendar_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  category: GoogleCalendarConfig["category"];
}

function mapStatus(s: string | null | undefined): EventRow["status"] {
  if (s === "tentative") return "tentative";
  return "confirmed";
}

function mapEvent(
  cal: GoogleCalendarConfig,
  ev: GoogleEvent,
): EventRow | null {
  const start = ev.start?.dateTime ?? ev.start?.date ?? null;
  const end = ev.end?.dateTime ?? ev.end?.date ?? null;
  if (!ev.id || !start) return null; // deleted/cancelled events carry no start
  return {
    source: "google",
    google_event_id: ev.id,
    google_calendar_id: cal.id,
    title: ev.summary?.trim() || "(no title)",
    description: ev.description ?? null,
    location: ev.location ?? null,
    starts_at: start,
    ends_at: end,
    all_day: Boolean(ev.start?.date) && !ev.start?.dateTime,
    status: mapStatus(ev.status),
    category: cal.category,
  };
}

/** List all (single-instance) events within the rolling window, paged. */
async function fetchWindow(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const res = await calendar.events.list({
      calendarId,
      singleEvents: true,
      orderBy: "startTime",
      showDeleted: false,
      maxResults: 2500,
      timeMin,
      timeMax,
      pageToken,
    });
    events.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return events;
}

/**
 * Which of these event ids are already stored by some other row — another
 * calendar's sync, or any non-google row — since the unique index on
 * google_event_id spans the whole table.
 */
async function eventsOnOtherCalendars(supabase: Db, calendarId: string, eventIds: string[]): Promise<Set<string>> {
  const owned = new Set<string>();
  // Chunked so a large first sync can't blow past PostgREST's URL length cap.
  for (let i = 0; i < eventIds.length; i += 200) {
    const { data, error } = await supabase
      .from("calendar_event")
      .select("google_event_id, google_calendar_id, source")
      .in("google_event_id", eventIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { google_event_id: string | null; google_calendar_id: string | null; source: string }[]) {
      const ours = r.source === "google" && r.google_calendar_id === calendarId;
      if (r.google_event_id && !ours) owned.add(r.google_event_id);
    }
  }
  return owned;
}

/**
 * Mirror a single Google calendar into greendogops.calendar_event for the
 * rolling window. Idempotent windowed refresh: inserts new events, updates
 * changed ones, and prunes google rows for this calendar that are no longer
 * returned (cancelled / deleted / rolled out of the window). Records the run in
 * calendar_sync_state (keyed by the calendar id).
 */
async function syncOneCalendar(
  supabase: Db,
  calendar: calendar_v3.Calendar,
  cal: GoogleCalendarConfig,
  windowStart: string,
  windowEnd: string,
): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = {
    calendarId: cal.id,
    label: cal.label,
    ok: true,
    fetched: 0,
    inserted: 0,
    updated: 0,
    removed: 0,
    shared: 0,
  };

  try {
    const events = await fetchWindow(calendar, cal.id, windowStart, windowEnd);
    result.fetched = events.length;

    // Existing google rows for this calendar → google_event_id -> row id.
    // Paginated: PostgREST caps every select at 1000 rows, and the table can
    // hold more google rows than that.
    const { data: existing } = await fetchAllRows<{
      id: string;
      google_event_id: string | null;
    }>((from, to) =>
      supabase
        .from("calendar_event")
        .select("id, google_event_id")
        .eq("source", "google")
        .eq("google_calendar_id", cal.id)
        .range(from, to),
    );
    const idByEvent = new Map<string, string>();
    for (const r of existing ?? []) {
      if (r.google_event_id) idByEvent.set(r.google_event_id, r.id);
    }

    const incomingIds = new Set<string>();
    const toInsert: EventRow[] = [];

    for (const ev of events) {
      const row = mapEvent(cal, ev);
      if (!row) continue;
      incomingIds.add(row.google_event_id);
      const rowId = idByEvent.get(row.google_event_id);
      if (rowId) {
        const { error } = await supabase
          .from("calendar_event")
          .update(row)
          .eq("id", rowId);
        if (error) throw new Error(error.message);
        result.updated += 1;
      } else {
        toInsert.push(row);
      }
    }

    const { insert, shared } = partitionNewEvents(
      toInsert,
      await eventsOnOtherCalendars(supabase, cal.id, toInsert.map((r) => r.google_event_id)),
    );
    result.shared = shared;
    if (insert.length > 0) {
      const { error } = await supabase.from("calendar_event").insert(insert);
      if (error) throw new Error(error.message);
      result.inserted = insert.length;
    }

    // Prune google rows no longer present (cancelled / deleted / out of window).
    const staleIds: string[] = [];
    for (const [eventId, rowId] of idByEvent) {
      if (!incomingIds.has(eventId)) staleIds.push(rowId);
    }
    // Chunk deletes so a large prune can't blow past PostgREST's URL length cap.
    for (let i = 0; i < staleIds.length; i += 200) {
      const chunk = staleIds.slice(i, i + 200);
      const { error } = await supabase
        .from("calendar_event")
        .delete()
        .in("id", chunk);
      if (error) throw new Error(error.message);
      result.removed += chunk.length;
    }

    await supabase.from("calendar_sync_state").upsert(
      {
        google_calendar_id: cal.id,
        last_synced_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
      },
      { onConflict: "google_calendar_id" },
    );

    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("calendar_sync_state").upsert(
      {
        google_calendar_id: cal.id,
        last_synced_at: new Date().toISOString(),
        last_status: "error",
        last_error: message,
      },
      { onConflict: "google_calendar_id" },
    );
    return { ...result, ok: false, error: message };
  }
}

/**
 * Mirror every configured Google calendar into greendogops.calendar_event for
 * the rolling window. Runs with the service-role admin client (no user session
 * — invoked by cron / a gated server action). Each calendar is synced
 * independently so one failing calendar does not abort the others.
 */
export async function syncGoogleCalendar(): Promise<SyncResult> {
  const supabase = createAdminClient();
  const calendars = getGoogleCalendars();

  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - LOOKBACK_DAYS);
  const end = new Date(now);
  end.setDate(end.getDate() + LOOKAHEAD_DAYS);
  const windowStart = start.toISOString();
  const windowEnd = end.toISOString();

  const base: SyncResult = {
    ok: true,
    fetched: 0,
    inserted: 0,
    updated: 0,
    removed: 0,
    windowStart,
    windowEnd,
    calendars: [],
  };

  if (calendars.length === 0) {
    return {
      ...base,
      ok: false,
      error:
        "No Google calendars configured. Set one of the GOOGLE_*_CALENDAR_ID variables " +
        "(see src/lib/calendar/calendar-env.ts).",
    };
  }

  const calendar = getCalendarClient();

  for (const cal of calendars) {
    const res = await syncOneCalendar(
      supabase,
      calendar,
      cal,
      windowStart,
      windowEnd,
    );
    base.calendars.push(res);
    base.fetched += res.fetched;
    base.inserted += res.inserted;
    base.updated += res.updated;
    base.removed += res.removed;
    if (!res.ok) base.ok = false;
  }

  const failed = base.calendars.filter((c) => !c.ok);
  if (failed.length > 0) {
    base.error = failed
      .map((c) => `${c.label}: ${c.error ?? "sync failed"}`)
      .join("; ");
  }

  return base;
}
