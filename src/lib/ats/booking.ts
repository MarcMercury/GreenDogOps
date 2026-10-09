import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditModule, type AppUser } from "@/lib/auth/permissions";
import { logProfileTransition } from "@/lib/shared/transition-log";
import { candidateName, candidateProfileUrl } from "./slack-notify";
import { slackInterviewScheduled } from "./slack-announce";
import { createGoogleInterviewEvent, googleBusy } from "./google-calendar";
import { sendBookingConfirmationEmail, sendInterviewerBookingEmail } from "./candidate-emails";
import {
  DEFAULT_TIMEZONE,
  addDays,
  buildIcs,
  candidateInterviewTitle,
  computeSlots,
  formatClock,
  formatLongDate,
  parseWeeklyHours,
  zoneAbbreviation,
  zonedParts,
  zonedTimeToUtc,
  type Interval,
  type WeeklyWindow,
} from "./scheduling";

// ---------------------------------------------------------------------------
// Interview self-scheduling — the server side. An interview_invite names one
// interviewer and a date range; the candidate's /book/<token> page offers the
// interviewer's open slots (weekly availability minus Google busy time minus
// interviews already in Ops) and booking one creates the person_interview,
// the Google event, the emails and the Slack post.
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>;

export interface InterviewerSchedule {
  user_id: string;
  name: string;
  email: string;
  timezone: string;
  windows: WeeklyWindow[];
  default_duration: number;
  buffer_minutes: number;
  min_notice_hours: number;
  is_active: boolean;
  google_email: string | null;
  google_connected: boolean;
}

interface ScheduleRow {
  user_id: string;
  timezone: string;
  weekly_hours: unknown;
  default_duration: number;
  buffer_minutes: number;
  min_notice_hours: number;
  is_active: boolean;
  google_email: string | null;
  google_connected_at: string | null;
}

function toSchedule(user: Pick<AppUser, "id" | "full_name" | "email">, row: ScheduleRow | null): InterviewerSchedule {
  return {
    user_id: user.id,
    name: user.full_name?.trim() || user.email.split("@")[0],
    email: user.email,
    timezone: row?.timezone || DEFAULT_TIMEZONE,
    windows: parseWeeklyHours(row?.weekly_hours),
    default_duration: row?.default_duration ?? 30,
    buffer_minutes: row?.buffer_minutes ?? 15,
    min_notice_hours: row?.min_notice_hours ?? 12,
    is_active: row?.is_active ?? false,
    google_email: row?.google_email ?? null,
    google_connected: Boolean(row?.google_connected_at),
  };
}

/** Everyone who can work the ATS, with their scheduling settings (if any). */
export async function loadInterviewers(admin: Admin = createAdminClient()): Promise<InterviewerSchedule[]> {
  const [{ data: users }, { data: rows }] = await Promise.all([
    admin.from("app_user").select("*").eq("is_active", true).order("full_name"),
    admin.from("recruiter_schedule").select("*"),
  ]);
  const byUser = new Map(((rows ?? []) as ScheduleRow[]).map((r) => [r.user_id, r]));
  return ((users ?? []) as AppUser[])
    .filter((u) => canEditModule(u, "ats"))
    .map((u) => toSchedule(u, byUser.get(u.id) ?? null));
}

export async function loadInterviewer(
  userId: string,
  admin: Admin = createAdminClient(),
): Promise<InterviewerSchedule | null> {
  const [{ data: user }, { data: row }] = await Promise.all([
    admin.from("app_user").select("id, full_name, email").eq("id", userId).maybeSingle(),
    admin.from("recruiter_schedule").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  if (!user) return null;
  return toSchedule(user as AppUser, (row as ScheduleRow | null) ?? null);
}

/** Bookable = active, with at least one weekly window. */
export function canTakeBookings(s: InterviewerSchedule): boolean {
  return s.is_active && s.windows.length > 0;
}

/** Interviews already in Ops for this interviewer (by link or by name). */
async function opsBusy(
  admin: Admin,
  host: InterviewerSchedule,
  dateFrom: string,
  dateTo: string,
): Promise<Interval[]> {
  const { data } = await admin
    .from("person_interview")
    .select("interview_date, start_time, end_time, host_user_id, interviewer")
    .eq("status", "scheduled")
    .gte("interview_date", addDays(dateFrom, -1))
    .lte("interview_date", addDays(dateTo, 1))
    .not("start_time", "is", null);
  const name = host.name.toLowerCase();
  const out: Interval[] = [];
  for (const r of (data ?? []) as {
    interview_date: string;
    start_time: string;
    end_time: string | null;
    host_user_id: string | null;
    interviewer: string | null;
  }[]) {
    const mine =
      r.host_user_id === host.user_id ||
      (!r.host_user_id && (r.interviewer ?? "").trim().toLowerCase() === name);
    if (!mine) continue;
    const start = zonedTimeToUtc(r.interview_date, r.start_time.slice(0, 5), host.timezone);
    const end = r.end_time
      ? zonedTimeToUtc(r.interview_date, r.end_time.slice(0, 5), host.timezone)
      : new Date(start.getTime() + 60 * 60000);
    out.push({ start, end });
  }
  return out;
}

export interface InviteRow {
  id: string;
  token: string;
  person_id: string;
  interview_type: string;
  duration_minutes: number;
  host_user_id: string;
  host_name: string | null;
  date_from: string;
  date_to: string;
  location: string | null;
  message: string | null;
  status: "sent" | "booked" | "cancelled";
  interview_id: string | null;
  booked_start: string | null;
}

export type SlotsResult =
  | { ok: true; slots: Date[]; timeZone: string; host: InterviewerSchedule }
  | { ok: false; error: string };

/**
 * Open start times for one interviewer over a date range. A connected
 * calendar that can't be read yields an error rather than times that might
 * double-book.
 */
export async function slotsFor(
  host: InterviewerSchedule,
  range: { dateFrom: string; dateTo: string; durationMinutes: number },
  now = new Date(),
  admin: Admin = createAdminClient(),
): Promise<SlotsResult> {
  if (!canTakeBookings(host)) {
    return { ok: false, error: `${host.name} hasn't set their interview availability yet.` };
  }
  const today = zonedParts(now, host.timezone).date;
  const dateFrom = range.dateFrom < today ? today : range.dateFrom;
  if (range.dateTo < dateFrom) return { ok: true, slots: [], timeZone: host.timezone, host };

  const from = zonedTimeToUtc(dateFrom, "00:00", host.timezone);
  const to = zonedTimeToUtc(addDays(range.dateTo, 1), "00:00", host.timezone);
  const [google, ops] = await Promise.all([
    googleBusy(host.user_id, from, to),
    opsBusy(admin, host, dateFrom, range.dateTo),
  ]);
  if (google.connected && google.error) {
    return { ok: false, error: `Couldn't read ${host.name}'s Google Calendar (${google.error}).` };
  }
  const slots = computeSlots({
    windows: host.windows,
    timeZone: host.timezone,
    dateFrom,
    dateTo: range.dateTo,
    durationMinutes: range.durationMinutes,
    bufferMinutes: host.buffer_minutes,
    minNoticeMinutes: host.min_notice_hours * 60,
    now,
    busy: [...google.busy, ...ops],
  });
  return { ok: true, slots, timeZone: host.timezone, host };
}

export async function slotsForInvite(invite: InviteRow, now = new Date()): Promise<SlotsResult> {
  const admin = createAdminClient();
  const host = await loadInterviewer(invite.host_user_id, admin);
  if (!host) return { ok: false, error: "This interviewer is no longer available." };
  return slotsFor(
    host,
    { dateFrom: invite.date_from, dateTo: invite.date_to, durationMinutes: invite.duration_minutes },
    now,
    admin,
  );
}

/** "Tuesday, October 13 · 11:30 AM PDT" */
export function formatWhen(at: Date, timeZone: string): string {
  return `${formatLongDate(at, timeZone)} · ${formatClock(at, timeZone)} ${zoneAbbreviation(at, timeZone)}`;
}

export type BookResult =
  | { ok: true; when: string; withName: string | null; title: string }
  | { ok: false; error: string; taken?: boolean };

/**
 * Book the candidate's chosen time. The slot is re-checked against live
 * availability, and the invite is claimed atomically (status sent → booked) so
 * a double-click or two tabs can't create two interviews.
 */
export async function bookInvite(token: string, startIso: string): Promise<BookResult> {
  const admin = createAdminClient();
  const { data: inviteData } = await admin
    .from("interview_invite")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  const invite = inviteData as InviteRow | null;
  if (!invite || invite.status === "cancelled") {
    return { ok: false, error: "This scheduling link is no longer active." };
  }
  if (invite.status === "booked") {
    return { ok: false, error: "This interview is already booked." };
  }

  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return { ok: false, error: "Pick a time." };
  const available = await slotsForInvite(invite);
  if (!available.ok) return { ok: false, error: available.error };
  if (!available.slots.some((s) => s.getTime() === start.getTime())) {
    return { ok: false, error: "That time was just taken. Please pick another.", taken: true };
  }
  const { host, timeZone } = available;
  const end = new Date(start.getTime() + invite.duration_minutes * 60000);

  const local = zonedParts(start, timeZone);
  const localEnd = zonedParts(end, timeZone);
  const withName = invite.host_name || host.name;
  const interview = {
    interview_date: local.date,
    start_time: local.time,
    end_time: localEnd.time,
    interview_type: invite.interview_type,
    interviewer: withName,
    location: invite.location,
  };
  const { data: booked, error: bookErr } = await admin.rpc("book_interview_slot", {
    p_invite_id: invite.id,
    p_date: local.date,
    p_start: local.time,
    p_end: localEnd.time,
    p_interviewer: withName,
    p_booked_start: start.toISOString(),
  });
  if (bookErr || !booked) {
    const msg = bookErr?.message ?? "";
    if (msg.includes("slot_taken")) {
      return { ok: false, error: "That time was just taken. Please pick another.", taken: true };
    }
    if (msg.includes("invite_unavailable")) return { ok: false, error: "This interview is already booked." };
    console.error("[ats] booking failed:", msg);
    return { ok: false, error: "We couldn't book that time. Please try again." };
  }
  const interviewId = booked as string;

  const { data: personData } = await admin
    .from("person")
    .select("full_name, first_name, last_name, email, phone_mobile")
    .eq("id", invite.person_id)
    .maybeSingle();
  const person = personData as {
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_mobile: string | null;
  } | null;
  const name = person ? candidateName(person) : "Candidate";
  const title = candidateInterviewTitle(invite.interview_type);
  const when = formatWhen(start, timeZone);
  const profileUrl = candidateProfileUrl(invite.person_id);

  const google = await createGoogleInterviewEvent(host.user_id, {
    summary: `${title}: ${name} — Green Dog`,
    description: [
      `${title} with ${name}.`,
      person?.phone_mobile ? `Phone: ${person.phone_mobile}` : null,
      person?.email ? `Email: ${person.email}` : null,
      invite.location ? `Where: ${invite.location}` : null,
      `Candidate profile: ${profileUrl}`,
    ]
      .filter(Boolean)
      .join("\n"),
    location: invite.location,
    start,
    end,
    timeZone,
    attendeeEmail: person?.email ?? null,
    attendeeName: name,
  });
  if (google.eventId) {
    await admin.from("person_interview").update({ google_event_id: google.eventId }).eq("id", interviewId);
  } else if (google.error) {
    console.error("[ats] Google event create failed:", google.error);
  }

  const ics = buildIcs({
    uid: `${interviewId}@greendogops`,
    start,
    end,
    summary: `${title} with Green Dog`,
    description: [withName ? `With ${withName}` : null, invite.location].filter(Boolean).join("\n"),
    location: invite.location,
  });
  const googleInvited = Boolean(google.eventId && person?.email);
  if (person?.email) {
    const sent = await sendBookingConfirmationEmail({
      to: person.email,
      firstName: person.first_name,
      title,
      when,
      withName,
      location: invite.location,
      ics: googleInvited ? null : ics,
      googleInviteSent: googleInvited,
    });
    if (!sent.ok) console.error("[ats] booking confirmation email failed:", sent.error);
  }
  // The interviewer is always told; Google doesn't email the organizer.
  if (host.email) {
    const onGoogleCalendar = Boolean(google.eventId);
    const sent = await sendInterviewerBookingEmail({
      to: host.email,
      candidateName: name,
      title,
      when,
      location: invite.location,
      profileUrl,
      onGoogleCalendar,
      ics: onGoogleCalendar
        ? null
        : buildIcs({
            uid: `${interviewId}-host@greendogops`,
            start,
            end,
            summary: `${title}: ${name}`,
            description: `Candidate profile: ${profileUrl}`,
            location: invite.location,
          }),
    });
    if (!sent.ok) console.error("[ats] interviewer booking email failed:", sent.error);
  }

  await logProfileTransition({
    personId: invite.person_id,
    eventType: "interview_booked",
    detail: `${title} booked for ${when} with ${withName}`,
  });

  await slackInterviewScheduled(invite.person_id, interview, { name: withName, authId: null, email: null });

  return { ok: true, when, withName, title };
}
