import "server-only";
import type { calendar_v3 } from "googleapis";
import { getCalendarClient, getCalendarId } from "./google";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/paginate";

// Rolling window we mirror. Recurring events are expanded (singleEvents) only
// within this window so an open-ended series can't explode into thousands of
// far-future rows.
const LOOKBACK_DAYS = 90;
const LOOKAHEAD_DAYS = 400;

export interface SyncResult {
  ok: boolean;
  calendarId: string;
  fetched: number;
  inserted: number;
  updated: number;
  removed: number;
  windowStart: string;
  windowEnd: string;
  error?: string;
}

type GoogleEvent = calendar_v3.Schema$Event;

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
}

function mapStatus(s: string | null | undefined): EventRow["status"] {
  if (s === "tentative") return "tentative";
  return "confirmed";
}

function mapEvent(calendarId: string, ev: GoogleEvent): EventRow | null {
  const start = ev.start?.dateTime ?? ev.start?.date ?? null;
  const end = ev.end?.dateTime ?? ev.end?.date ?? null;
  if (!ev.id || !start) return null; // deleted/cancelled events carry no start
  return {
    source: "google",
    google_event_id: ev.id,
    google_calendar_id: calendarId,
    title: ev.summary?.trim() || "(no title)",
    description: ev.description ?? null,
    location: ev.location ?? null,
    starts_at: start,
    ends_at: end,
    all_day: Boolean(ev.start?.date) && !ev.start?.dateTime,
    status: mapStatus(ev.status),
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
 * Mirror the company Google Calendar into greendogops.calendar_event for the
 * rolling window. Runs with the service-role admin client (no user session —
 * invoked by cron / a gated server action). Idempotent windowed refresh:
 * inserts new events, updates changed ones, and prunes google rows that are no
 * longer returned (cancelled / deleted / rolled out of the window).
 */
export async function syncGoogleCalendar(): Promise<SyncResult> {
  const calendarId = getCalendarId();
  const supabase = createAdminClient();

  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - LOOKBACK_DAYS);
  const end = new Date(now);
  end.setDate(end.getDate() + LOOKAHEAD_DAYS);
  const windowStart = start.toISOString();
  const windowEnd = end.toISOString();

  const base: Omit<SyncResult, "ok" | "error"> = {
    calendarId,
    fetched: 0,
    inserted: 0,
    updated: 0,
    removed: 0,
    windowStart,
    windowEnd,
  };

  try {
    const calendar = getCalendarClient();
    const events = await fetchWindow(calendar, calendarId, windowStart, windowEnd);
    base.fetched = events.length;

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
        .eq("google_calendar_id", calendarId)
        .range(from, to),
    );
    const idByEvent = new Map<string, string>();
    for (const r of existing ?? []) {
      if (r.google_event_id) idByEvent.set(r.google_event_id, r.id);
    }

    const incomingIds = new Set<string>();
    const toInsert: EventRow[] = [];

    for (const ev of events) {
      const row = mapEvent(calendarId, ev);
      if (!row) continue;
      incomingIds.add(row.google_event_id);
      const rowId = idByEvent.get(row.google_event_id);
      if (rowId) {
        const { error } = await supabase
          .from("calendar_event")
          .update(row)
          .eq("id", rowId);
        if (error) throw new Error(error.message);
        base.updated += 1;
      } else {
        toInsert.push(row);
      }
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from("calendar_event").insert(toInsert);
      if (error) throw new Error(error.message);
      base.inserted = toInsert.length;
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
      base.removed += chunk.length;
    }

    await supabase.from("calendar_sync_state").upsert(
      {
        google_calendar_id: calendarId,
        last_synced_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
      },
      { onConflict: "google_calendar_id" },
    );

    return { ok: true, ...base };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("calendar_sync_state").upsert(
      {
        google_calendar_id: calendarId,
        last_synced_at: new Date().toISOString(),
        last_status: "error",
        last_error: message,
      },
      { onConflict: "google_calendar_id" },
    );
    return { ok: false, ...base, error: message };
  }
}
