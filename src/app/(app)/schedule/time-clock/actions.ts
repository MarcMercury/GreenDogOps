"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, recordAudit, type CurrentUser } from "@/lib/auth/session";
import { canApproveTime } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, isIsoDate, todayInWorkTz } from "@/lib/worklist/dates";
import { localToInstant } from "@/lib/timeclock/local-time";
import { TIME_CLOCK_TZ } from "@/lib/timeclock/server";
import { isPunchType, PUNCH_LABELS } from "@/lib/timeclock/state";

// Approver actions (go-live plan D9: Owner, Admin, Executive, HR / Manager).
// The database functions are atomic and idempotent; this layer checks the
// role, refuses approvers acting on their own time, and audits every change.

export type ApproverResult = { ok: true; message: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How far back an approver may add a missing punch. */
const ADD_PUNCH_WINDOW_DAYS = 45;

const ERRORS: Record<string, string> = {
  note_required: "Please add a note explaining the decision.",
  already_reviewed: "Someone has already decided this punch.",
  not_pending: "This has already been handled.",
  not_found: "Not found — it may have been removed.",
  replace_target_required: "Pick which punch the corrected time replaces.",
  replace_target_invalid: "That punch doesn't belong to this employee.",
  already_voided: "That punch has already been replaced.",
  future_time: "The requested time is in the future.",
  invalid_decision: "Unknown decision.",
};

async function approverGate(): Promise<{ ok: true; current: CurrentUser } | { ok: false; error: string }> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "You are not signed in (or this is a read-only preview)." };
  if (!canApproveTime(current.appUser)) {
    return { ok: false, error: "Only Owners, Admins, Executives and HR / Managers can change timecards." };
  }
  return { ok: true, current };
}

function notOwnTime(current: CurrentUser, personId: string): ApproverResult | null {
  return current.appUser.person_id && current.appUser.person_id === personId
    ? { ok: false, error: "You can't approve or change your own time. Ask another approver." }
    : null;
}

function refresh() {
  revalidatePath("/schedule/time-clock");
  revalidatePath("/me");
  revalidatePath("/me/timecard");
  revalidatePath("/");
}

export async function reviewOffsitePunch(
  punchId: string,
  decision: "approved" | "rejected",
  note: string,
): Promise<ApproverResult> {
  const gate = await approverGate();
  if (!gate.ok) return gate;
  if (!UUID.test(punchId) || (decision !== "approved" && decision !== "rejected")) {
    return { ok: false, error: "Unknown punch or decision." };
  }
  const admin = createAdminClient();
  const { data: punch } = await admin.from("time_punch").select("person_id").eq("id", punchId).maybeSingle();
  if (!punch) return { ok: false, error: ERRORS.not_found };
  const own = notOwnTime(gate.current, punch.person_id as string);
  if (own) return own;

  const { data, error } = await admin.rpc("review_time_punch", {
    p_punch_id: punchId,
    p_decision: decision,
    p_note: note?.slice(0, 1000) ?? null,
    p_reviewer: gate.current.appUser.id,
  });
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return { ok: false, error: ERRORS[res.error ?? ""] ?? "Not saved." };

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: decision === "approved" ? "timeclock.offsite_approved" : "timeclock.offsite_rejected",
    entity: "time_punch",
    entityId: punchId,
    summary: decision === "approved" ? "Approved an off-site punch" : "Rejected an off-site punch (voided)",
    metadata: { person_id: punch.person_id, note: note || null },
  });
  refresh();
  return { ok: true, message: decision === "approved" ? "Approved." : "Rejected — the punch no longer counts." };
}

export async function decideCorrection(
  requestId: string,
  decision: "approved" | "denied",
  note: string,
  replaceTarget: string | null,
): Promise<ApproverResult> {
  const gate = await approverGate();
  if (!gate.ok) return gate;
  if (!UUID.test(requestId) || (decision !== "approved" && decision !== "denied")) {
    return { ok: false, error: "Unknown request or decision." };
  }
  let replacePunchId: string | null = null;
  let replaceAdjustmentId: string | null = null;
  if (replaceTarget) {
    const [kind, id] = replaceTarget.split(":");
    if (!UUID.test(id ?? "")) return { ok: false, error: ERRORS.replace_target_invalid };
    if (kind === "punch") replacePunchId = id;
    else if (kind === "adjustment") replaceAdjustmentId = id;
    else return { ok: false, error: ERRORS.replace_target_invalid };
  }
  const admin = createAdminClient();
  const { data: req } = await admin
    .from("time_correction_request")
    .select("person_id, kind")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { ok: false, error: ERRORS.not_found };
  const own = notOwnTime(gate.current, req.person_id as string);
  if (own) return own;

  const { data, error } = await admin.rpc("decide_time_correction", {
    p_request_id: requestId,
    p_decision: decision,
    p_note: note?.slice(0, 1000) ?? null,
    p_reviewer: gate.current.appUser.id,
    p_replace_punch_id: replacePunchId,
    p_replace_adjustment_id: replaceAdjustmentId,
  });
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return { ok: false, error: ERRORS[res.error ?? ""] ?? "Not saved." };

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: decision === "approved" ? "timeclock.correction_approved" : "timeclock.correction_denied",
    entity: "time_correction_request",
    entityId: requestId,
    summary: `${decision === "approved" ? "Approved" : "Denied"} a time correction (${req.kind})`,
    metadata: {
      person_id: req.person_id,
      note: note || null,
      replace_punch_id: replacePunchId,
      replace_adjustment_id: replaceAdjustmentId,
    },
  });
  refresh();
  return { ok: true, message: decision === "approved" ? "Approved — the timecard is updated." : "Denied." };
}

export async function addMissingPunch(formData: FormData): Promise<ApproverResult> {
  const gate = await approverGate();
  if (!gate.ok) return gate;
  const personId = String(formData.get("person_id") ?? "");
  const workDate = String(formData.get("work_date") ?? "");
  const punchType = String(formData.get("punch_type") ?? "");
  const time = String(formData.get("time") ?? "");
  const nextDay = formData.get("next_day") === "on";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);

  if (!UUID.test(personId)) return { ok: false, error: "Unknown employee." };
  const own = notOwnTime(gate.current, personId);
  if (own) return own;
  const today = todayInWorkTz();
  if (!isIsoDate(workDate) || workDate > today || workDate < addDays(today, -ADD_PUNCH_WINDOW_DAYS)) {
    return { ok: false, error: `Pick a date within the last ${ADD_PUNCH_WINDOW_DAYS} days.` };
  }
  if (!isPunchType(punchType)) return { ok: false, error: "Pick which punch." };
  if (!reason) return { ok: false, error: "Please give a reason." };
  const instant = localToInstant(nextDay ? addDays(workDate, 1) : workDate, time, TIME_CLOCK_TZ);
  if (!instant) return { ok: false, error: "Enter a valid time." };
  if (instant.getTime() > Date.now()) return { ok: false, error: "That time is in the future." };

  const admin = createAdminClient();
  const { data: person } = await admin.from("person").select("id").eq("id", personId).maybeSingle();
  if (!person) return { ok: false, error: "Unknown employee." };

  const { data: row, error } = await admin
    .from("time_punch_adjustment")
    .insert({
      person_id: personId,
      action: "add",
      punch_type: punchType,
      punched_at: instant.toISOString(),
      work_date: workDate,
      reason,
      created_by: gate.current.appUser.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: `Could not save: ${error.message}` };

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "timeclock.punch_added",
    entity: "time_punch_adjustment",
    entityId: row.id as string,
    summary: `Added a missing ${PUNCH_LABELS[punchType].toLowerCase()} punch`,
    metadata: { person_id: personId, work_date: workDate, punched_at: instant.toISOString(), reason },
  });
  refresh();
  return { ok: true, message: `${PUNCH_LABELS[punchType]} added.` };
}
