"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, requestMeta } from "@/lib/security/rate-limit";
import { addDays, isIsoDate, todayInWorkTz } from "@/lib/worklist/dates";
import { localToInstant } from "@/lib/timeclock/local-time";
import { runInBackground } from "@/lib/notify/emit";
import {
  notifyCorrectionRequested,
  notifyCorrectionWithdrawn,
  notifyOffsitePunch,
} from "@/lib/notify/events/timeclock";
import { TIME_CLOCK_NOTICE_VERSION } from "@/lib/timeclock/notice";
import { evaluateLocation, type LocationCheck } from "@/lib/timeclock/location-check";
import {
  getClockLocations,
  getMyShifts,
  getSessionLocationId,
  hasAckedNotice,
  resolveSelf,
  TIME_CLOCK_TZ,
  type SelfPerson,
} from "@/lib/timeclock/server";
import { localMinutes, pickShift } from "@/lib/timeclock/shift-match";
import { CORRECTION_WINDOW_DAYS, isPunchType, PUNCH_LABELS, type PunchType } from "@/lib/timeclock/state";

// Self-service time clock. Every action acts ONLY on the signed-in user's own
// HR person (app_user.person_id); nothing about whose record it is comes from
// the client. Staff are read-only in the database (0239) and the tables are
// service-role only (0240), so writes use the service role after these checks.
// getCurrentUser() refuses during a "View as" preview.

export type TimeActionResult = { ok: true; message: string } | { ok: false; error: string };

/** A punch result; `offsite` asks the employee to confirm "Working off-site" with a note. */
export type PunchResult =
  | { ok: true; message: string; needsApproval: boolean }
  | { ok: false; error: string; offsite?: { reason: string } };

async function selfGate(): Promise<
  { ok: true; person: SelfPerson; appUserId: string } | { ok: false; error: string }
> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "You are not signed in (or this is a read-only preview)." };
  if (!canAccessModule(current.appUser, "my_time")) {
    return { ok: false, error: "You do not have access to My Time." };
  }
  const self = await resolveSelf(current.appUser);
  if (!self.ok) {
    return {
      ok: false,
      error:
        self.reason === "no_profile"
          ? "Your login is not linked to an HR profile yet. Ask HR to link it."
          : "Only active employees and contractors can use the time clock.",
    };
  }
  return { ok: true, person: self.person, appUserId: current.appUser.id };
}

function finiteIn(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

export interface PunchInput {
  type: PunchType;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  clientTime?: string | null;
  /** Clock-out only, non-exempt staff: "Were you able to take your rest breaks today?" */
  restBreaksOk?: boolean | null;
  /** The employee chose "Working off-site" after a failed location check. */
  offsiteNote?: string | null;
  /** Clock-in only: "I forgot to clock out — start a new shift" (last punch > 8 h old). */
  abandonPrevious?: boolean;
}

const PUNCH_ERRORS: Record<string, string> = {
  invalid_transition: "That punch doesn't fit where you are in your day. The page has been refreshed — try again.",
  not_eligible: "Only active employees and contractors can use the time clock.",
  rest_breaks_only_on_clock_out: "The rest-break answer belongs to clock-out.",
  invalid_type: "Unknown punch.",
  note_required: "Please say why you're working off-site.",
  invalid_location_check: "The location check failed. Please try again.",
};

export async function recordPunch(input: PunchInput): Promise<PunchResult> {
  const gate = await selfGate();
  if (!gate.ok) return gate;
  const { person } = gate;
  if (!person.canPunch) return { ok: false, error: PUNCH_ERRORS.not_eligible };
  if (!isPunchType(input?.type)) return { ok: false, error: PUNCH_ERRORS.invalid_type };

  if (!(await hasAckedNotice(person.id))) {
    return { ok: false, error: "Please read and accept the time-clock notice first." };
  }
  if (!(await rateLimit(`timeclock:punch:${person.id}`, 20, 600))) {
    return { ok: false, error: "Too many punches in a short time. Please wait a minute." };
  }

  let restBreaksOk: boolean | null = null;
  if (input.type === "clock_out" && person.nonExempt) {
    if (typeof input.restBreaksOk !== "boolean") {
      return { ok: false, error: "Please answer whether you were able to take your rest breaks." };
    }
    restBreaksOk = input.restBreaksOk;
  }

  const latitude = finiteIn(input.latitude, -90, 90);
  const longitude = finiteIn(input.longitude, -180, 180);
  const hasGps = latitude !== null && longitude !== null;
  const clientTime =
    typeof input.clientTime === "string" && !Number.isNaN(Date.parse(input.clientTime))
      ? new Date(input.clientTime).toISOString()
      : null;

  // A clock-in is matched to the nearest published shift today; later punches
  // inherit the session's shift in the database and are checked against its
  // clinic.
  let assignmentId: string | null = null;
  let locationId: string | null = null;
  if (input.type === "clock_in") {
    const today = todayInWorkTz();
    const shifts = await getMyShifts(person.id, today, today);
    const match = pickShift(shifts, localMinutes(new Date(), TIME_CLOCK_TZ));
    assignmentId = match?.assignment_id ?? null;
    locationId = match?.location_id ?? null;
  }
  const scheduledLocationId = input.type === "clock_in" ? locationId : await getSessionLocationId(person.id);

  const meta = await requestMeta();
  const ip = meta.ip === "unknown" ? null : meta.ip;
  const accuracy = hasGps ? finiteIn(input.accuracy, 0, 100_000) : null;
  let check: LocationCheck;
  try {
    check = evaluateLocation(await getClockLocations(), scheduledLocationId, {
      ip,
      latitude: hasGps ? latitude : null,
      longitude: hasGps ? longitude : null,
      accuracy,
    });
  } catch (e) {
    // Never block a punch on a settings read: record it, unchecked.
    console.error("[timeclock] location settings unavailable:", (e as Error).message);
    check = { result: "not_checked", matchedLocationId: null, networkId: null, method: null, distanceM: null, reason: "Location settings unavailable." };
  }

  const offsiteNote = typeof input.offsiteNote === "string" ? input.offsiteNote.trim().slice(0, 1000) : "";
  if (check.result === "off_site" && !offsiteNote) {
    // D6: never refuse — ask the employee to confirm off-site work with a note.
    return { ok: false, error: "You don't appear to be at a Green Dog clinic.", offsite: { reason: check.reason } };
  }
  if (input.type === "clock_in" && !locationId && check.matchedLocationId) locationId = check.matchedLocationId;

  const { data, error } = await createAdminClient().rpc("record_time_punch", {
    p_person_id: person.id,
    p_punch_type: input.type,
    p_source: "self",
    p_created_by: gate.appUserId,
    p_location_id: locationId,
    p_assignment_id: assignmentId,
    p_ip: ip,
    p_user_agent: meta.userAgent,
    p_latitude: hasGps ? latitude : null,
    p_longitude: hasGps ? longitude : null,
    p_accuracy_m: accuracy,
    p_client_time: clientTime,
    p_note: check.result === "off_site" ? offsiteNote : null,
    p_rest_breaks_ok: restBreaksOk,
    p_location_check: check.result,
    p_timezone: TIME_CLOCK_TZ,
    p_matched_location_id: check.matchedLocationId,
    p_network_id: check.networkId,
    p_distance_m: check.distanceM,
    p_abandon_previous: input.type === "clock_in" && input.abandonPrevious === true,
  });
  if (error) {
    console.error("[timeclock] record_time_punch failed:", error.message);
    return { ok: false, error: "The punch could not be saved. Please try again, then tell your manager." };
  }
  const result = data as {
    ok: boolean;
    error?: string;
    duplicate?: boolean;
    punch_id?: string;
    punched_at?: string;
    needs_approval?: boolean;
  };
  if (!result.ok) return { ok: false, error: PUNCH_ERRORS[result.error ?? ""] ?? "The punch was not accepted." };
  if (result.needs_approval && !result.duplicate && result.punch_id) {
    const punchId = result.punch_id;
    runInBackground(() => notifyOffsitePunch(punchId, gate.appUserId));
  }

  revalidatePath("/me");
  revalidatePath("/me/timecard");
  const when = new Date(result.punched_at ?? Date.now()).toLocaleTimeString("en-US", {
    timeZone: TIME_CLOCK_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
  const needsApproval = result.needs_approval === true;
  return {
    ok: true,
    needsApproval,
    message: result.duplicate
      ? `Already recorded: ${PUNCH_LABELS[input.type]} at ${when}.`
      : `${PUNCH_LABELS[input.type]} recorded at ${when}.${needsApproval ? " It will go to a manager to approve." : ""}`,
  };
}

export async function acknowledgeTimeClockNotice(): Promise<TimeActionResult> {
  const gate = await selfGate();
  if (!gate.ok) return gate;
  const meta = await requestMeta();
  const { error } = await createAdminClient()
    .from("time_clock_notice_ack")
    .upsert(
      {
        person_id: gate.person.id,
        notice_version: TIME_CLOCK_NOTICE_VERSION,
        app_user_id: gate.appUserId,
        ip: meta.ip === "unknown" ? null : meta.ip,
        user_agent: meta.userAgent,
      },
      { onConflict: "person_id,notice_version", ignoreDuplicates: true },
    );
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  revalidatePath("/me");
  revalidatePath("/me/privacy");
  return { ok: true, message: "Thanks — you can use the time clock now." };
}

export async function requestTimeCorrection(formData: FormData): Promise<TimeActionResult> {
  const gate = await selfGate();
  if (!gate.ok) return gate;
  if (!(await rateLimit(`timeclock:correction:${gate.person.id}`, 10, 3600))) {
    return { ok: false, error: "Too many requests. Please try again later." };
  }

  const workDate = String(formData.get("work_date") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const punchTypeRaw = String(formData.get("punch_type") ?? "");
  const time = String(formData.get("time") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);

  const today = todayInWorkTz();
  if (!isIsoDate(workDate) || workDate > today || workDate < addDays(today, -CORRECTION_WINDOW_DAYS)) {
    return { ok: false, error: `Pick a date within the last ${CORRECTION_WINDOW_DAYS} days.` };
  }
  if (kind !== "missing_punch" && kind !== "wrong_time" && kind !== "other") {
    return { ok: false, error: "Pick what needs fixing." };
  }
  if (!reason) return { ok: false, error: "Please explain what happened." };

  let punchType: PunchType | null = null;
  let requestedTime: string | null = null;
  if (kind !== "other") {
    if (!isPunchType(punchTypeRaw)) return { ok: false, error: "Pick which punch." };
    // An overnight shift's clock-out can fall on the next calendar day.
    const nextDay = formData.get("next_day") === "on";
    const instant = localToInstant(nextDay ? addDays(workDate, 1) : workDate, time, TIME_CLOCK_TZ);
    if (!instant) return { ok: false, error: "Enter the correct time." };
    if (instant.getTime() > Date.now()) return { ok: false, error: "That time is in the future." };
    punchType = punchTypeRaw;
    requestedTime = instant.toISOString();
  }

  const { data: created, error } = await createAdminClient()
    .from("time_correction_request")
    .insert({
      person_id: gate.person.id,
      work_date: workDate,
      kind,
      punch_type: punchType,
      requested_time: requestedTime,
      reason,
      created_by: gate.appUserId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: `Could not send the request: ${error.message}` };
  const requestId = created.id as string;
  runInBackground(() => notifyCorrectionRequested(requestId, gate.appUserId));
  revalidatePath("/me/timecard");
  return { ok: true, message: "Request sent. A manager will review it." };
}

export async function cancelTimeCorrection(id: string): Promise<TimeActionResult> {
  const gate = await selfGate();
  if (!gate.ok) return gate;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Unknown request." };
  const { data, error } = await createAdminClient()
    .from("time_correction_request")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("person_id", gate.person.id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: `Could not cancel: ${error.message}` };
  if (!data?.length) return { ok: false, error: "Only your own pending requests can be cancelled." };
  runInBackground(() => notifyCorrectionWithdrawn(id));
  revalidatePath("/me/timecard");
  return { ok: true, message: "Request cancelled." };
}
