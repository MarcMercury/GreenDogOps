"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit, recordAudit, type CurrentUser } from "@/lib/auth/session";
import { logProfileTransition } from "@/lib/shared/transition-log";
import { isSlackConfigured } from "@/lib/slack/client";
import { buildStageChangeMessage, candidateName, notifyCandidateThread } from "@/lib/ats/slack-notify";
import { deleteGoogleEvent } from "@/lib/ats/google-calendar";
import { DECLINED_STAGE } from "@/lib/ats/types";
import {
  REJECTED_FROM_LABELS,
  REJECTION_DELAY_HOURS,
  canUndoRejection,
  cleanScore,
  type RejectedFrom,
  type Rejection,
} from "@/lib/ats/rejections";

export type SimpleResult = { ok: true } | { ok: false; error: string };

function actorName(current: CurrentUser): string {
  return current.appUser.full_name ?? current.email.split("@")[0];
}

function revalidateCandidate(personId: string) {
  revalidatePath("/ats");
  revalidatePath(`/ats/${personId}`);
}

/** Post a stage move in the candidate's thread (only once announced). */
function slackStage(personId: string, from: string | null, to: string | null, current: CurrentUser) {
  if (!isSlackConfigured()) return;
  after(async () => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("person")
      .select("full_name, first_name, last_name")
      .eq("id", personId)
      .maybeSingle();
    if (!data) return;
    await notifyCandidateThread({
      personId,
      text: buildStageChangeMessage(candidateName(data), from, to, actorName(current)),
      username: actorName(current),
      actorId: current.authId,
      actorEmail: current.email,
    });
  });
}

// ---------------------------------------------------------------------------
// Candidate Score (0–10) with history
// ---------------------------------------------------------------------------

export interface ScoreChange {
  id: string;
  old_score: number | null;
  new_score: number | null;
  note: string | null;
  changed_by_name: string | null;
  created_at: string;
}

export async function setCandidateScore(
  personId: string,
  score: number | string | null,
  note: string | null,
): Promise<{ ok: true; score: number | null } | { ok: false; error: string }> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const next = cleanScore(score);
  if (score !== null && score !== "" && next === null) return { ok: false, error: "Score must be between 0 and 10." };
  const supabase = await createClient();
  const { data } = await supabase.from("person_recruiting").select("score").eq("person_id", personId).maybeSingle();
  const prev = (data as { score: number | null } | null)?.score ?? null;
  const prevNum = prev == null ? null : Number(prev);
  if (prevNum === next) return { ok: true, score: next };

  const { error } = await supabase
    .from("person_recruiting")
    .upsert({ person_id: personId, score: next }, { onConflict: "person_id" });
  if (error) return { ok: false, error: error.message };
  await supabase.from("recruiting_score_change").insert({
    person_id: personId,
    old_score: prevNum,
    new_score: next,
    note: note?.trim().slice(0, 500) || null,
    changed_by: gate.current.authId,
    changed_by_name: actorName(gate.current),
  });
  revalidateCandidate(personId);
  return { ok: true, score: next };
}

export async function getScoreHistory(personId: string): Promise<ScoreChange[]> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("recruiting_score_change")
    .select("id, old_score, new_score, note, changed_by_name, created_at")
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as ScoreChange[];
}

// ---------------------------------------------------------------------------
// Rejections — the 48-hour email window and the Rejected queue
// ---------------------------------------------------------------------------

export interface RejectInput {
  from: RejectedFrom;
  sendEmail: boolean;
  templateId: string | null;
}

/**
 * Reject a candidate from any queue. Review-queue applicants become Declined;
 * anyone further along becomes Passed. Open questionnaire and scheduling links
 * and upcoming interviews are cancelled. With email on, the template goes out
 * after 48 hours unless the rejection is undone or the email cancelled first.
 */
export async function rejectCandidate(personId: string, input: RejectInput): Promise<SimpleResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  if (!(input.from in REJECTED_FROM_LABELS)) return { ok: false, error: "Unknown queue." };
  const supabase = await createClient();

  const { data } = await supabase
    .from("person")
    .select("id, email, person_recruiting(stage, review_status)")
    .eq("id", personId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That candidate no longer exists." };
  const recRaw = (data as { person_recruiting?: unknown }).person_recruiting;
  const rec = (Array.isArray(recRaw) ? recRaw[0] : recRaw) as { stage: string | null; review_status: string | null } | null;
  const email = (data as { email: string | null }).email;

  let templateName: string | null = null;
  if (input.sendEmail) {
    if (!input.templateId) return { ok: false, error: "Pick a rejection email template." };
    const { data: tpl } = await supabase
      .from("recruiting_email_template")
      .select("name, active")
      .eq("id", input.templateId)
      .maybeSingle();
    const t = tpl as { name: string; active: boolean } | null;
    if (!t?.active) return { ok: false, error: "That template is inactive. Pick another." };
    templateName = t.name;
  }

  const wasPending = rec?.review_status === "pending";
  const rejectedStage = wasPending || input.from === "review" ? DECLINED_STAGE : "Passed";
  const now = new Date();
  const { error } = await supabase
    .from("person_recruiting")
    .upsert(
      {
        person_id: personId,
        stage: rejectedStage,
        ...(wasPending
          ? { review_status: "declined", reviewed_at: now.toISOString(), reviewed_by: gate.current.authId }
          : {}),
      },
      { onConflict: "person_id" },
    );
  if (error) return { ok: false, error: error.message };

  // Close out anything still open for them.
  const today = now.toISOString().slice(0, 10);
  await Promise.all([
    supabase.from("recruiting_form_request").update({ status: "cancelled" }).eq("person_id", personId).eq("status", "sent"),
    supabase.from("interview_invite").update({ status: "cancelled" }).eq("person_id", personId).eq("status", "sent"),
  ]);
  const { data: upcoming } = await supabase
    .from("person_interview")
    .select("id, host_user_id, google_event_id, invite_id, interview_date")
    .eq("person_id", personId)
    .eq("status", "scheduled");
  for (const iv of (upcoming ?? []) as {
    id: string;
    host_user_id: string | null;
    google_event_id: string | null;
    invite_id: string | null;
    interview_date: string | null;
  }[]) {
    if (iv.interview_date && iv.interview_date < today) continue;
    await supabase.from("person_interview").update({ status: "cancelled", google_event_id: null }).eq("id", iv.id);
    if (iv.google_event_id && iv.host_user_id) await deleteGoogleEvent(iv.host_user_id, iv.google_event_id);
    if (iv.invite_id) await supabase.from("interview_invite").update({ status: "cancelled" }).eq("id", iv.invite_id);
  }

  const scheduled = input.sendEmail && !!email;
  const { error: rErr } = await supabase.from("recruiting_rejection").insert({
    person_id: personId,
    rejected_from: input.from,
    prev_stage: rec?.stage ?? null,
    prev_review_status: rec?.review_status ?? null,
    rejected_stage: rejectedStage,
    rejected_by: gate.current.authId,
    rejected_by_name: actorName(gate.current),
    rejected_at: now.toISOString(),
    send_email: input.sendEmail,
    template_id: input.sendEmail ? input.templateId : null,
    template_name: templateName,
    email_to: email,
    email_scheduled_for: scheduled
      ? new Date(now.getTime() + REJECTION_DELAY_HOURS * 3600000).toISOString()
      : null,
    email_status: scheduled ? "scheduled" : "not_sending",
    email_error: input.sendEmail && !email ? "No email address on file." : null,
  });
  if (rErr) return { ok: false, error: `Rejected, but the Rejected queue entry failed: ${rErr.message}` };

  await logProfileTransition({
    personId,
    eventType: "rejected",
    fromStage: rec?.stage ?? null,
    toStage: rejectedStage,
    detail: `Rejected from ${REJECTED_FROM_LABELS[input.from]}${scheduled ? ` — "${templateName}" email in ${REJECTION_DELAY_HOURS}h` : " — no email"}`,
    actorId: gate.current.authId,
    actorName: actorName(gate.current),
  });
  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "update",
    entity: "person",
    entityId: personId,
    summary: `Rejected candidate (${REJECTED_FROM_LABELS[input.from]})`,
  });
  slackStage(personId, rec?.stage ?? null, rejectedStage, gate.current);
  revalidateCandidate(personId);
  return { ok: true };
}

async function loadRejection(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase.from("recruiting_rejection").select("*").eq("id", id).maybeSingle();
  return data as Rejection | null;
}

/** Put the candidate back where they were (until the email has gone out). */
export async function undoRejection(rejectionId: string): Promise<SimpleResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const r = await loadRejection(supabase, rejectionId);
  if (!r) return { ok: false, error: "That rejection no longer exists." };
  if (!canUndoRejection(r)) {
    return { ok: false, error: r.undone_at ? "Already undone." : "The rejection email has already been sent." };
  }
  const { data: cur } = await supabase
    .from("person_recruiting")
    .select("stage")
    .eq("person_id", r.person_id)
    .maybeSingle();
  const currentStage = (cur as { stage: string | null } | null)?.stage ?? null;
  if (currentStage !== r.rejected_stage) {
    return {
      ok: false,
      error: `They've moved on since the rejection (now ${currentStage ?? "no stage"}), so there's nothing to undo.`,
    };
  }
  const { data: claimed } = await supabase
    .from("recruiting_rejection")
    .update({
      undone_at: new Date().toISOString(),
      undone_by_name: actorName(gate.current),
      ...(r.email_status === "scheduled" ? { email_status: "cancelled" } : {}),
    })
    .eq("id", r.id)
    .is("undone_at", null)
    .in("email_status", ["scheduled", "cancelled", "not_sending", "failed"])
    .select("id");
  if (!claimed?.length) return { ok: false, error: "The rejection email is going out right now — it can't be undone." };

  const restoreReview = r.prev_review_status === "pending";
  const { data: restored } = await supabase
    .from("person_recruiting")
    .update({
      stage: r.prev_stage,
      ...(restoreReview ? { review_status: "pending", reviewed_at: null, reviewed_by: null } : {}),
    })
    .eq("person_id", r.person_id)
    .eq("stage", r.rejected_stage ?? "")
    .select("person_id");
  if (!restored?.length) {
    return { ok: false, error: "They were moved while undoing — reload and check their stage." };
  }

  await logProfileTransition({
    personId: r.person_id,
    eventType: "rejection_undone",
    fromStage: r.rejected_stage,
    toStage: r.prev_stage,
    detail: restoreReview ? "Back in the Review Queue" : null,
    actorId: gate.current.authId,
    actorName: actorName(gate.current),
  });
  slackStage(r.person_id, r.rejected_stage, r.prev_stage, gate.current);
  revalidateCandidate(r.person_id);
  return { ok: true };
}

/** Keep the rejection but don't send the email. */
export async function cancelRejectionEmail(rejectionId: string): Promise<SimpleResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recruiting_rejection")
    .update({ email_status: "cancelled", email_error: `Cancelled by ${actorName(gate.current)}` })
    .eq("id", rejectionId)
    .eq("email_status", "scheduled")
    .select("person_id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "The email isn't waiting to send any more." };
  revalidateCandidate((data[0] as { person_id: string }).person_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rejection templates (ATS → Settings)
// ---------------------------------------------------------------------------

export interface TemplateInput {
  id?: string | null;
  name: string;
  subject: string;
  body: string;
  active: boolean;
}

export async function saveRejectionTemplate(input: TemplateInput): Promise<SimpleResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const name = input.name?.trim().slice(0, 120);
  const subject = input.subject?.trim().slice(0, 200);
  const body = input.body?.trim().slice(0, 10000);
  if (!name || !subject || !body) return { ok: false, error: "Name, subject and message are all required." };
  const supabase = await createClient();
  const row = { kind: "rejection", name, subject, body, active: input.active };
  let error;
  if (input.id) {
    ({ error } = await supabase.from("recruiting_email_template").update(row).eq("id", input.id));
  } else {
    const { data: last } = await supabase
      .from("recruiting_email_template")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    ({ error } = await supabase
      .from("recruiting_email_template")
      .insert({ ...row, sort_order: ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1 }));
  }
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: input.id ? "update" : "create",
    entity: "recruiting_email_template",
    entityId: input.id ?? undefined,
    summary: `${input.id ? "Updated" : "Created"} rejection template ${name}`,
  });
  revalidatePath("/ats/settings");
  revalidatePath("/ats");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Form Response Queue
// ---------------------------------------------------------------------------

/** Mark a completed questionnaire reviewed (drops it from "Needs review"). */
export async function markFormReviewed(requestId: string, reviewed = true): Promise<SimpleResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recruiting_form_request")
    .update(
      reviewed
        ? { reviewed_at: new Date().toISOString(), reviewed_by_name: actorName(gate.current) }
        : { reviewed_at: null, reviewed_by_name: null },
    )
    .eq("id", requestId)
    .select("person_id");
  if (error) return { ok: false, error: error.message };
  if (data?.[0]) revalidateCandidate((data[0] as { person_id: string }).person_id);
  return { ok: true };
}
