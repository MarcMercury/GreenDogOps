import "server-only";

// ---------------------------------------------------------------------------
// Upcoming-appointments report for Slack — a forward-looking "how full is next
// week" view, posted Tuesdays and Thursdays.
//
// One table per clinic: a row per open day, columns for the DENTAL lane (its
// NAD and OE make-up broken out), VE and AP. Each cell is booked / offered.
//
// Booked comes from upcoming_appointment_demand() (migration 0193), which reads
// the most recent Agenda pull per clinic-day and buckets each appointment by
// ezyvet_appt_type_dept_map.report_track. Offered comes from the weekly pattern
// in report_capacity_target, with report_capacity_override taking precedence on
// a specific date (closures, student days, an extra doctor).
//
// Runs through the service-role client. Callers MUST authorize first
// (CRON_SECRET for the cron route, module permissions for the manual button).
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { todayLA } from "@/lib/sheets/common";

const DAY_MS = 86_400_000;

/** Reporting lanes, in the order they appear as table columns. */
const TRACKS = ["dental", "ve", "ap"] as const;
type Track = (typeof TRACKS)[number];

/** Buckets an appointment type can fall into; nad + oe roll up to dental. */
type BookedTrack = "nad" | "oe" | "ve" | "ap";

const TRACK_OF: Record<BookedTrack, Track> = {
  nad: "dental",
  oe: "dental",
  ve: "ve",
  ap: "ap",
};

export interface UpcomingApptsReport {
  /** Slack mrkdwn body. */
  text: string;
  /** Monday of the reported week, YYYY-MM-DD. */
  weekStart: string;
  /** Sunday of the reported week, YYYY-MM-DD. */
  weekEnd: string;
  /** Date of the Agenda pull the booked numbers came from, or null. */
  bookedAsOf: string | null;
}

interface DemandRow {
  location_id: string;
  location_name: string;
  appt_date: string;
  report_track: BookedTrack;
  booked: number;
}

interface TargetRow {
  location_id: string;
  track: Track;
  weekday: number;
  capacity: number;
}

interface OverrideRow {
  location_id: string;
  track: Track;
  appt_date: string;
  capacity: number;
  note: string | null;
}

interface LocationRow {
  id: string;
  name: string;
  sort_order: number | null;
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Public origin for links back into the app, without a trailing slash. */
function appBaseUrl(): string {
  const raw =
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  return raw.replace(/\/+$/, "");
}

/**
 * The NEXT calendar week, Monday–Sunday, relative to today in the clinics'
 * timezone. Posted midweek, this is the week the team is still filling.
 */
function nextCalendarWeek(): { start: string; end: string } {
  const today = todayLA();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const thisMonday = addDays(today, dow === 0 ? -6 : 1 - dow);
  const start = addDays(thisMonday, 7);
  return { start, end: addDays(start, 6) };
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `Mon 9/21` */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAY_LABELS[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function monthDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Left-align every column to the widest cell in it, two-space gutter. */
function renderTable(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i])))
      .join("  ")
      .trimEnd(),
  );
}

/** `16/18`, `16/18 FULL`, `5/—` when nothing is offered, `—` when closed. */
function cell(booked: number, capacity: number): string {
  if (capacity <= 0) return booked > 0 ? `${booked}/—` : "—";
  const ratio = `${booked}/${capacity}`;
  return booked >= capacity ? `${ratio} FULL` : ratio;
}

function key(...parts: (string | number)[]): string {
  return parts.join("|");
}

/**
 * Build the report for the next calendar week. Days on which a clinic offers
 * nothing and has nothing booked are dropped, and a clinic with no such days
 * is left out entirely.
 */
export async function buildUpcomingApptsReport(): Promise<UpcomingApptsReport> {
  const supabase = createAdminClient();
  const week = nextCalendarWeek();

  const [demandRes, targetRes, overrideRes, locationRes, snapshotRes] =
    await Promise.all([
      supabase.rpc("upcoming_appointment_demand", {
        p_start: week.start,
        p_end: week.end,
      }),
      supabase
        .from("report_capacity_target")
        .select("location_id, track, weekday, capacity"),
      supabase
        .from("report_capacity_override")
        .select("location_id, track, appt_date, capacity, note")
        .gte("appt_date", week.start)
        .lte("appt_date", week.end),
      supabase
        .from("location")
        .select("id, name, sort_order")
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      supabase
        .from("ezyvet_agenda_appt_snapshot")
        .select("snapshot_date")
        .order("snapshot_date", { ascending: false })
        .limit(1),
    ]);

  const demand = (demandRes.data ?? []) as DemandRow[];
  const targets = (targetRes.data ?? []) as TargetRow[];
  const overrides = (overrideRes.data ?? []) as OverrideRow[];
  const locations = (locationRes.data ?? []) as LocationRow[];
  const bookedAsOf =
    ((snapshotRes.data ?? []) as { snapshot_date: string }[])[0]?.snapshot_date ??
    null;

  // booked[location|date|track] and the NAD/OE split behind the dental lane.
  const booked = new Map<string, number>();
  const bySubTrack = new Map<string, number>();
  for (const row of demand) {
    const track = TRACK_OF[row.report_track];
    if (!track) continue;
    const n = Number(row.booked ?? 0);
    const k = key(row.location_id, row.appt_date, track);
    booked.set(k, (booked.get(k) ?? 0) + n);
    const sub = key(row.location_id, row.appt_date, row.report_track);
    bySubTrack.set(sub, (bySubTrack.get(sub) ?? 0) + n);
  }

  const targetBy = new Map(
    targets.map((t) => [key(t.location_id, t.track, t.weekday), t.capacity]),
  );
  const overrideBy = new Map(
    overrides.map((o) => [key(o.location_id, o.track, o.appt_date), o]),
  );

  const dates = Array.from({ length: 7 }, (_, i) => addDays(week.start, i));

  const lines: string[] = [
    `*Upcoming appointments* · week of ${monthDay(week.start)}–${monthDay(week.end)}`,
    "_Each cell is booked / slots offered. Dental = NAD + OE._",
  ];

  let anyClinic = false;

  for (const location of locations) {
    const header = ["Day", "Dental", "NAD", "OE", "VE", "AP"];
    const body: string[][] = [];
    const notes: string[] = [];
    let totalBooked = 0;
    let totalCapacity = 0;

    for (const date of dates) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const cells: Record<Track, { booked: number; capacity: number }> = {
        dental: { booked: 0, capacity: 0 },
        ve: { booked: 0, capacity: 0 },
        ap: { booked: 0, capacity: 0 },
      };

      for (const track of TRACKS) {
        const override = overrideBy.get(key(location.id, track, date));
        cells[track] = {
          booked: booked.get(key(location.id, date, track)) ?? 0,
          capacity:
            override?.capacity ?? targetBy.get(key(location.id, track, weekday)) ?? 0,
        };
        if (override?.note) {
          notes.push(`${dayLabel(date)} — ${track.toUpperCase()}: ${override.note}`);
        }
      }

      const dayBooked = TRACKS.reduce((s, t) => s + cells[t].booked, 0);
      const dayCapacity = TRACKS.reduce((s, t) => s + cells[t].capacity, 0);
      // Closed everywhere and nothing on the books: not worth a row.
      if (dayBooked === 0 && dayCapacity === 0) continue;

      totalBooked += dayBooked;
      totalCapacity += dayCapacity;
      const nad = bySubTrack.get(key(location.id, date, "nad")) ?? 0;
      const oe = bySubTrack.get(key(location.id, date, "oe")) ?? 0;
      body.push([
        dayLabel(date),
        cell(cells.dental.booked, cells.dental.capacity),
        nad > 0 ? String(nad) : "—",
        oe > 0 ? String(oe) : "—",
        cell(cells.ve.booked, cells.ve.capacity),
        cell(cells.ap.booked, cells.ap.capacity),
      ]);
    }

    if (body.length === 0) continue;
    anyClinic = true;

    const open = Math.max(totalCapacity - totalBooked, 0);
    const fill = totalCapacity > 0 ? Math.round((totalBooked / totalCapacity) * 100) : 0;
    lines.push(
      "",
      `*${location.name}* — ${totalBooked}/${totalCapacity} booked · ${open} open · ${fill}% full`,
      "```",
      ...renderTable([header, ...body]),
      "```",
    );
    for (const note of notes) lines.push(`_${note}_`);
  }

  if (!anyClinic) {
    lines.push(
      "",
      "_No capacity targets or bookings found for next week. Set the weekly slot counts on Daily Capacity._",
    );
  }

  lines.push(
    "",
    bookedAsOf
      ? `_Booked as of the ${monthDay(bookedAsOf)} Agenda pull._ <${appBaseUrl()}/capacity|Daily Capacity →>`
      : `<${appBaseUrl()}/capacity|Daily Capacity →>`,
  );

  return {
    text: lines.join("\n"),
    weekStart: week.start,
    weekEnd: week.end,
    bookedAsOf,
  };
}
