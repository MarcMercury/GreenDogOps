"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureCanEdit, recordAudit, type CurrentUser } from "@/lib/auth/session";
import { logProfileTransition } from "@/lib/shared/transition-log";
import { isEmailConfigured } from "@/lib/shared/email";
import { INTERVIEW_TYPE_LABELS } from "@/lib/ats/types";
import {
  DEFAULT_TIMEZONE,
  candidateInterviewTitle,
  isIsoDate,
  linkToken,
  parseWeeklyHours,
  type WeeklyWindow,
} from "@/lib/ats/scheduling";
import {
  canTakeBookings,
  formatWhen,
  loadInterviewer,
  slotsFor,
} from "@/lib/ats/booking";
import { disconnectGoogle } from "@/lib/ats/google-calendar";
import { sendSchedulingInviteEmail } from "@/lib/ats/candidate-emails";
import { appBaseUrl } from "@/lib/ats/slack-notify";

export type SimpleResult = { ok: true } | { ok: false; error: string };

function actorName(current: CurrentUser): string {
  return current.appUser.full_name ?? current.email.split("@")[0];
}

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface AvailabilityInput {
  timezone: string;
  weekly_hours: WeeklyWindow[];
  default_duration: number;
  buffer_minutes: number;
  min_notice_hours: number;
  is_active: boolean;
}

/** Save the signed-in recruiter's interview availability. */
export async function saveAvailability(input: AvailabilityInput): Promise<SimpleResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const timezone = input.timezone || DEFAULT_TIMEZONE;
  if (!validTimeZone(timezone)) return { ok: false, error: "Unknown time zone." };
  const windows = parseWeeklyHours(input.weekly_hours);
  if (windows.length !== (input.weekly_hours?.length ?? 0)) {
    return { ok: false, error: "Each block needs an end time after its start time." };
  }
  const int = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
  const admin = createAdminClient();
  const { error } = await admin.from("recruiter_schedule").upsert(
    {
      user_id: gate.current.authId,
      timezone,
      weekly_hours: windows,
      default_duration: int(input.default_duration, 10, 240),
      buffer_minutes: int(input.buffer_minutes, 0, 120),
      min_notice_hours: int(input.min_notice_hours, 0, 336),
      is_active: input.is_active,
    },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/ats/availability");
  return { ok: true };
}

export async function disconnectGoogleCalendar(): Promise<SimpleResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  await disconnectGoogle(gate.current.authId);
  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "update",
    entity: "app_user",
    entityId: gate.current.authId,
    summary: "Disconnected Google Calendar from interview scheduling",
  });
  revalidatePath("/ats/availability");
  return { ok: true };
}

export interface InviteInput {
  interviewType: string;
  /** app_user id of the interviewer. */
  hostUserId: string;
  durationMinutes: number;
  dateFrom: string;
  dateTo: string;
  location: string | null;
  message: string | null;
}

function checkInvite(input: InviteInput): string | null {
  if (!(input.interviewType in INTERVIEW_TYPE_LABELS)) return "Pick an interview type.";
  if (!isIsoDate(input.dateFrom) || !isIsoDate(input.dateTo)) return "Pick a date range.";
  if (input.dateTo < input.dateFrom) return "The range ends before it starts.";
  const d = Number(input.durationMinutes);
  if (!Number.isInteger(d) || d < 10 || d > 240) return "Pick a duration between 10 and 240 minutes.";
  return null;
}

export type PreviewResult =
  | { ok: true; count: number; first: string | null }
  | { ok: false; error: string };

/** How many open times the candidate would see — shown before sending. */
export async function previewInviteSlots(input: InviteInput): Promise<PreviewResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const problem = checkInvite(input);
  if (problem) return { ok: false, error: problem };
  const host = await loadInterviewer(input.hostUserId);
  if (!host) return { ok: false, error: "Pick an interviewer." };
  const res = await slotsFor(host, {
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    durationMinutes: input.durationMinutes,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    count: res.slots.length,
    first: res.slots[0] ? formatWhen(res.slots[0], res.timeZone) : null,
  };
}

export type InviteResult =
  | { ok: true; url: string; emailed: boolean; count: number; warning?: string }
  | { ok: false; error: string };

/**
 * Send a candidate a "choose a time" link for one interviewer. Replaces any
 * unbooked link of the same interview type so only one is live.
 */
export async function sendSchedulingInvite(personId: string, input: InviteInput): Promise<InviteResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const problem = checkInvite(input);
  if (problem) return { ok: false, error: problem };

  const supabase = await createClient();
  const { data: personData } = await supabase
    .from("person")
    .select("id, first_name, email")
    .eq("id", personId)
    .maybeSingle();
  const person = personData as { id: string; first_name: string | null; email: string | null } | null;
  if (!person) return { ok: false, error: "That candidate no longer exists." };

  const host = await loadInterviewer(input.hostUserId);
  if (!host) return { ok: false, error: "Pick an interviewer." };
  if (!canTakeBookings(host)) {
    return { ok: false, error: `${host.name} hasn't set their interview availability yet (Recruiting → My Availability).` };
  }
  const preview = await slotsFor(host, {
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    durationMinutes: input.durationMinutes,
  });
  if (!preview.ok) return preview;
  if (preview.slots.length === 0) {
    return { ok: false, error: `${host.name} has no open times in that range. Widen the dates or pick someone else.` };
  }

  await supabase
    .from("interview_invite")
    .update({ status: "cancelled" })
    .eq("person_id", personId)
    .eq("interview_type", input.interviewType)
    .eq("status", "sent");

  const token = linkToken();
  const { error } = await supabase.from("interview_invite").insert({
    token,
    person_id: personId,
    interview_type: input.interviewType,
    duration_minutes: input.durationMinutes,
    host_user_id: host.user_id,
    host_name: host.name,
    date_from: input.dateFrom,
    date_to: input.dateTo,
    location: input.location?.trim() || null,
    message: input.message?.trim() || null,
    sent_to: person.email,
    created_by: gate.current.authId,
    created_by_name: actorName(gate.current),
  });
  if (error) return { ok: false, error: error.message };
  const url = `${appBaseUrl()}/book/${token}`;
  const title = candidateInterviewTitle(input.interviewType);

  let emailed = false;
  let warning: string | undefined;
  if (!person.email) warning = "No email on file — copy the link and send it yourself.";
  else if (!isEmailConfigured()) warning = "Email isn't set up — copy the link and send it yourself.";
  else {
    const sent = await sendSchedulingInviteEmail({
      to: person.email,
      firstName: person.first_name,
      headline: `Green Dog would like to schedule a ${input.durationMinutes}-minute ${title.toLowerCase()} with you.`,
      message: input.message,
      url,
    });
    emailed = sent.ok;
    if (!sent.ok) warning = `The email didn't send (${sent.error}). Copy the link and send it yourself.`;
  }

  await logProfileTransition({
    personId,
    eventType: "schedule_invite",
    detail: `${title} link sent — ${host.name}, ${input.durationMinutes} min, ${input.dateFrom} to ${input.dateTo}`,
    actorId: gate.current.authId,
    actorName: actorName(gate.current),
  });
  revalidatePath(`/ats/${personId}`);
  return { ok: true, url, emailed, count: preview.slots.length, ...(warning ? { warning } : {}) };
}

export async function cancelSchedulingInvite(personId: string, inviteId: string): Promise<SimpleResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("interview_invite")
    .update({ status: "cancelled" })
    .eq("id", inviteId)
    .eq("person_id", personId)
    .eq("status", "sent");
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/ats/${personId}`);
  return { ok: true };
}
