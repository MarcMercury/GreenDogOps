import "server-only";

// ---------------------------------------------------------------------------
// Time-clock notification events (go-live checklist item 13).
//
// Called from the My Time and Scheduling ▸ Time Clock Server Actions (via
// runInBackground) after the change has been saved. Each loads what it needs
// with the service role and hands it to emitEvent(); none of them throws.
// Payloads carry names, times and the employee's own note only — never GPS,
// IP addresses or pay data (DMs leave the app).
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { shortDateLabel } from "@/lib/worklist/dates";
import { formatClockTime } from "@/lib/timeclock/local-time";
import { PUNCH_LABELS, type PunchType } from "@/lib/timeclock/state";
import { emitEvent } from "../emit";
import { resolveCards } from "../engine";
import { personDisplayName } from "../directory";

type Admin = ReturnType<typeof createAdminClient>;
const TZ = "America/Los_Angeles";

const KIND_LABELS: Record<string, string> = {
  missing_punch: "Forgot to punch",
  wrong_time: "Wrong time",
  other: "Something else",
};

async function personName(admin: Admin, personId: string): Promise<string> {
  const { data } = await admin
    .from("person")
    .select("full_name, first_name, last_name, preferred_name")
    .eq("id", personId)
    .maybeSingle();
  return data ? personDisplayName(data as Parameters<typeof personDisplayName>[0]) : "An employee";
}

async function locationName(admin: Admin, id: string | null): Promise<string> {
  if (!id) return "";
  const { data } = await admin.from("location").select("name, display_name").eq("id", id).maybeSingle();
  const l = data as { name: string; display_name: string | null } | null;
  return l ? l.display_name || l.name : "";
}

const whenLabel = (workDate: string, at: string) => `${shortDateLabel(workDate)} · ${formatClockTime(at, TZ)}`;

async function safely(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[notify] ${label}:`, err instanceof Error ? err.message : err);
  }
}

interface PunchRow {
  id: string;
  person_id: string;
  punch_type: PunchType;
  punched_at: string;
  work_date: string;
  location_id: string | null;
  note: string | null;
}

async function loadPunch(admin: Admin, id: string): Promise<PunchRow | null> {
  const { data } = await admin
    .from("time_punch")
    .select("id, person_id, punch_type, punched_at, work_date, location_id, note")
    .eq("id", id)
    .maybeSingle();
  return (data as PunchRow | null) ?? null;
}

/** An off-site punch is waiting for an approver. */
export function notifyOffsitePunch(punchId: string, actorUserId: string | null): Promise<void> {
  return safely("timeclock.offsite_pending", async () => {
    const admin = createAdminClient();
    const p = await loadPunch(admin, punchId);
    if (!p) return;
    await emitEvent({
      type: "timeclock.offsite_pending",
      subjectType: "time_punch",
      subjectId: p.id,
      subjectPersonIds: [p.person_id],
      locationId: p.location_id,
      actorUserId,
      payload: {
        personName: await personName(admin, p.person_id),
        punchLabel: PUNCH_LABELS[p.punch_type],
        when: whenLabel(p.work_date, p.punched_at),
        locationName: (await locationName(admin, p.location_id)) || "Unscheduled",
        note: p.note ?? "",
      },
      dedupeKey: `timeclock.offsite_pending:${p.id}`,
    });
  });
}

export function notifyPunchReviewed(input: {
  punchId: string;
  decision: "approved" | "rejected";
  note: string | null;
  reviewerName: string;
  actorUserId: string | null;
}): Promise<void> {
  return safely("timeclock.punch_reviewed", async () => {
    const admin = createAdminClient();
    const p = await loadPunch(admin, input.punchId);
    if (!p) return;
    await emitEvent({
      type: "timeclock.punch_reviewed",
      subjectType: "time_punch",
      subjectId: p.id,
      subjectPersonIds: [p.person_id],
      locationId: p.location_id,
      actorUserId: input.actorUserId,
      payload: {
        personName: await personName(admin, p.person_id),
        punchLabel: PUNCH_LABELS[p.punch_type],
        when: whenLabel(p.work_date, p.punched_at),
        decision: input.decision,
        note: input.note ?? "",
      },
      dedupeKey: `timeclock.punch_reviewed:${p.id}`,
      resolve: {
        messageKey: `timepunch:${p.id}`,
        note: `${input.decision === "approved" ? "✅ Approved" : "❌ Rejected"} by ${input.reviewerName}`,
      },
    });
  });
}

interface CorrectionRow {
  id: string;
  person_id: string;
  work_date: string;
  kind: string;
  punch_type: PunchType | null;
  requested_time: string | null;
  reason: string;
}

async function loadCorrection(admin: Admin, id: string): Promise<CorrectionRow | null> {
  const { data } = await admin
    .from("time_correction_request")
    .select("id, person_id, work_date, kind, punch_type, requested_time, reason")
    .eq("id", id)
    .maybeSingle();
  return (data as CorrectionRow | null) ?? null;
}

export function notifyCorrectionRequested(requestId: string, actorUserId: string | null): Promise<void> {
  return safely("timeclock.correction_requested", async () => {
    const admin = createAdminClient();
    const c = await loadCorrection(admin, requestId);
    if (!c) return;
    const request = [
      KIND_LABELS[c.kind] ?? c.kind,
      c.punch_type
        ? `${PUNCH_LABELS[c.punch_type]}${c.requested_time ? ` at ${formatClockTime(c.requested_time, TZ)}` : ""}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    await emitEvent({
      type: "timeclock.correction_requested",
      subjectType: "time_correction_request",
      subjectId: c.id,
      subjectPersonIds: [c.person_id],
      actorUserId,
      payload: {
        personName: await personName(admin, c.person_id),
        dateLabel: shortDateLabel(c.work_date),
        request,
        reason: c.reason,
      },
      dedupeKey: `timeclock.correction_requested:${c.id}`,
    });
  });
}

/** The employee withdrew the request: update the approvers' cards. */
export function notifyCorrectionWithdrawn(requestId: string): Promise<void> {
  return safely("timeclock.correction_withdrawn", async () => {
    await resolveCards(`timecorr:${requestId}`, "Withdrawn by the employee");
  });
}

export function notifyCorrectionDecided(input: {
  requestId: string;
  decision: "approved" | "denied";
  note: string | null;
  reviewerName: string;
  actorUserId: string | null;
}): Promise<void> {
  return safely("timeclock.correction_decided", async () => {
    const admin = createAdminClient();
    const c = await loadCorrection(admin, input.requestId);
    if (!c) return;
    await emitEvent({
      type: "timeclock.correction_decided",
      subjectType: "time_correction_request",
      subjectId: c.id,
      subjectPersonIds: [c.person_id],
      actorUserId: input.actorUserId,
      payload: {
        personName: await personName(admin, c.person_id),
        dateLabel: shortDateLabel(c.work_date),
        decision: input.decision,
        note: input.note ?? "",
      },
      dedupeKey: `timeclock.correction_decided:${c.id}`,
      resolve: {
        messageKey: `timecorr:${c.id}`,
        note: `${input.decision === "approved" ? "✅ Approved" : "❌ Denied"} by ${input.reviewerName}`,
      },
    });
  });
}

export function notifyPunchAdded(adjustmentId: string, actorUserId: string | null): Promise<void> {
  return safely("timeclock.punch_added", async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("time_punch_adjustment")
      .select("id, person_id, punch_type, punched_at, work_date, reason, action")
      .eq("id", adjustmentId)
      .maybeSingle();
    const a = data as {
      id: string;
      person_id: string;
      punch_type: PunchType | null;
      punched_at: string | null;
      work_date: string;
      reason: string;
      action: string;
    } | null;
    if (!a || a.action !== "add" || !a.punch_type || !a.punched_at) return;
    await emitEvent({
      type: "timeclock.punch_added",
      subjectType: "time_punch_adjustment",
      subjectId: a.id,
      subjectPersonIds: [a.person_id],
      actorUserId,
      payload: {
        personName: await personName(admin, a.person_id),
        punchLabel: PUNCH_LABELS[a.punch_type],
        when: whenLabel(a.work_date, a.punched_at),
        reason: a.reason,
      },
      dedupeKey: `timeclock.punch_added:${a.id}`,
    });
  });
}
