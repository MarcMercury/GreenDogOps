"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, ensureCanEdit, recordAudit, type CurrentUser } from "@/lib/auth/session";
import { ensureAuthUserForPerson } from "@/lib/auth/auto-provision";
import { logProfileTransition } from "@/lib/shared/transition-log";
import { isAdminRole } from "@/lib/auth/permissions";
import {
  workbookToRows,
  rowsToCandidates,
  extractListCandidates,
  extractResumeCandidate,
} from "@/lib/ats/import";
import {
  candidateHasIdentity,
  type ParsedCandidate,
  type ParseListResult,
  type ParseResumeResult,
  type CreateCandidatesResult,
} from "@/lib/ats/import-types";
import {
  ACCEPTED_LEAD_STAGE,
  DECLINED_STAGE,
  ACTIVITY_TYPE_LABELS,
  POSITION_PRIORITY_LABELS,
  POSITION_STATUS_LABELS,
  POSITION_EMPLOYMENT_LABELS,
  POSITION_WORK_LOCATION_LABELS,
  POSITION_PAY_TYPE_LABELS,
  isRecruitingStage,
  type CandidateDocument,
  type CandidateRow,
  type PersonInterview,
} from "@/lib/ats/types";
import { buildInterviewSummary } from "@/lib/ats/slack-summary";
import {
  normalizeJobLocation,
  normalizePipeline,
  normalizePositionTitle,
  normalizeSource,
  normalizeStage,
} from "@/lib/ats/normalize";
import {
  buildAnnouncementMessage,
  buildInterviewScheduledMessage,
  buildStageChangeMessage,
  candidateName,
  candidateProfileUrl,
  notifyCandidateThread,
} from "@/lib/ats/slack-notify";
import { esc } from "@/lib/ats/slack-messages";
import { postSlackMessage, isSlackConfigured } from "@/lib/slack/client";
import { formatPhoneNumber } from "@/lib/shared/phone";
import { cityOrZipLookup } from "@/lib/shared/zip-lookup";
import { guessDocumentCategory } from "@/lib/ats/document-category";
import {
  APP_EDIT_MARKER,
  applicationFromFormData,
  type ApplicationDetails,
} from "@/lib/ats/application";

function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function bool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true";
}

/** Reads a form field and normalizes it to the app-wide phone format. */
function phone(v: FormDataEntryValue | null): string | null {
  return formatPhoneNumber(str(v));
}

export type SaveResult = { ok: true } | { ok: false; error: string };

function actorName(current: CurrentUser): string {
  return current.appUser.full_name ?? current.email.split("@")[0];
}

/**
 * Record a recruiting stage move: a History-tab transition row plus a Slack
 * reply in the candidate's announcement thread. The Slack post runs after the
 * response so a slow Slack API never holds up the save.
 */
async function recordStageChange(
  personId: string,
  fromStage: string | null,
  toStage: string | null,
  current: CurrentUser,
): Promise<void> {
  if ((fromStage ?? "") === (toStage ?? "")) return;
  const name = actorName(current);
  await logProfileTransition({
    personId,
    eventType: "stage_change",
    fromStage,
    toStage,
    actorId: current.authId,
    actorName: name,
  });
  if (!isSlackConfigured()) return;
  after(async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("person")
      .select("full_name, first_name, last_name")
      .eq("id", personId)
      .maybeSingle();
    if (!data) return;
    await notifyCandidateThread({
      personId,
      text: buildStageChangeMessage(candidateName(data), fromStage, toStage, name),
      username: name,
      actorId: current.authId,
      actorEmail: current.email,
    });
  });
}

async function currentStage(personId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("person_recruiting")
    .select("stage")
    .eq("person_id", personId)
    .maybeSingle();
  return (data as { stage?: string | null } | null)?.stage ?? null;
}

/** The application as edited on the profile, keeping what the editor doesn't show. */
async function editedApplication(
  personId: string,
  formData: FormData,
): Promise<ApplicationDetails> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("person_recruiting")
    .select("application")
    .eq("person_id", personId)
    .maybeSingle();
  const base = (data as { application?: ApplicationDetails | null } | null)?.application ?? null;
  return applicationFromFormData(formData, base);
}

export async function updateCandidate(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const personPatch = {
    first_name: str(formData.get("first_name")),
    last_name: str(formData.get("last_name")),
    email: str(formData.get("email")),
    phone_mobile: phone(formData.get("phone_mobile")),
    phone_home: phone(formData.get("phone_home")),
    phone_other: phone(formData.get("phone_other")),
    date_of_birth: str(formData.get("date_of_birth")),
    postal_code: str(formData.get("postal_code")),
    opportunity_type: str(formData.get("opportunity_type")),
  };
  const { error: pErr } = await supabase
    .from("person")
    .update(personPatch)
    .eq("id", personId);
  if (pErr) return { ok: false, error: pErr.message };

  const fromStage = await currentStage(personId);
  const recPatch = {
    person_id: personId,
    ...(formData.has("target_position_id")
      ? { target_position_id: str(formData.get("target_position_id")) }
      : {}),
    pipeline: normalizePipeline(str(formData.get("pipeline"))),
    stage: normalizeStage(str(formData.get("stage"))),
    target_title: normalizePositionTitle(str(formData.get("target_title"))),
    source: normalizeSource(str(formData.get("source"))),
    source_detail: str(formData.get("source_detail")),
    application_date: str(formData.get("application_date")),
    interview_date: str(formData.get("interview_date")),
    score: num(formData.get("score")),
    resume_url: str(formData.get("resume_url")),
    keep_for_future: bool(formData.get("keep_for_future")),
    follow_up_date: str(formData.get("follow_up_date")),
    candidate_location: await cityOrZipLookup(
      str(formData.get("candidate_location")),
      personPatch.postal_code,
    ),
    relevant_experience: str(formData.get("relevant_experience")),
    education: str(formData.get("education")),
    job_location: normalizeJobLocation(str(formData.get("job_location"))),
    interest_level: str(formData.get("interest_level")),
    status_notes: str(formData.get("status_notes")),
    notes: str(formData.get("notes")),
    ...(formData.get(APP_EDIT_MARKER) === "1"
      ? { application: await editedApplication(personId, formData) }
      : {}),
  };
  const { error: rErr } = await supabase
    .from("person_recruiting")
    .upsert(recPatch, { onConflict: "person_id" });
  if (rErr) return { ok: false, error: rErr.message };

  await recordStageChange(personId, fromStage, recPatch.stage, gate.current);

  revalidatePath(`/ats/${personId}`);
  revalidatePath("/ats");
  return { ok: true };
}

/** Inline stage change from the pipeline list or profile header. */
export async function updateCandidateStage(
  personId: string,
  stage: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  if (!isRecruitingStage(stage)) return { ok: false, error: "Unknown stage." };

  const fromStage = await currentStage(personId);
  if (fromStage === stage) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("person_recruiting")
    .upsert({ person_id: personId, stage }, { onConflict: "person_id" });
  if (error) return { ok: false, error: error.message };

  await recordStageChange(personId, fromStage, stage, gate.current);

  revalidatePath(`/ats/${personId}`);
  revalidatePath("/ats");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Interview tracking
// ---------------------------------------------------------------------------

export async function saveInterview(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("interview_id"));

  // Collect structured question/answer pairs (question_<n> + answer_<n>).
  const responses: { index: number; question: string; answer: string | null }[] =
    [];
  for (const [key, value] of formData.entries()) {
    const m = /^question_(\d+)$/.exec(key);
    if (!m) continue;
    const idx = Number(m[1]);
    responses.push({
      index: idx,
      question: String(value),
      answer: str(formData.get(`answer_${m[1]}`)),
    });
  }
  responses.sort((a, b) => a.index - b.index);
  const cleanResponses = responses.map((r) => ({
    question: r.question,
    answer: r.answer,
  }));

  const patch = {
    person_id: personId,
    interview_date: str(formData.get("interview_date")),
    interview_type: str(formData.get("interview_type")),
    interviewer: str(formData.get("interviewer")),
    location: str(formData.get("location")),
    status: str(formData.get("status")) ?? "scheduled",
    overall_grade: str(formData.get("overall_grade")),
    recommendation: str(formData.get("recommendation")),
    summary: str(formData.get("summary")),
    responses: cleanResponses,
    start_time: str(formData.get("start_time")),
    end_time: str(formData.get("end_time")),
  };

  // Note what was scheduled before so only a newly scheduled (or rescheduled)
  // interview is announced — not every edit to notes or grades.
  type ScheduledSnapshot = Pick<PersonInterview, "status" | "interview_date" | "start_time">;
  let before: ScheduledSnapshot | null = null;
  if (id) {
    const { data } = await supabase
      .from("person_interview")
      .select("status, interview_date, start_time")
      .eq("id", id)
      .maybeSingle();
    before = data as ScheduledSnapshot | null;
  }

  const { error } = id
    ? await supabase.from("person_interview").update(patch).eq("id", id)
    : await supabase.from("person_interview").insert(patch);

  if (error) return { ok: false, error: error.message };

  const newlyScheduled =
    patch.status === "scheduled" &&
    patch.interview_date != null &&
    (!before ||
      before.status !== "scheduled" ||
      before.interview_date !== patch.interview_date ||
      (before.start_time ?? "").slice(0, 5) !== (patch.start_time ?? "").slice(0, 5));
  if (newlyScheduled && isSlackConfigured()) {
    const current = gate.current;
    after(async () => {
      const admin = createAdminClient();
      const { data } = await admin
        .from("person")
        .select("full_name, first_name, last_name")
        .eq("id", personId)
        .maybeSingle();
      if (!data) return;
      await notifyCandidateThread({
        personId,
        text: buildInterviewScheduledMessage(candidateName(data), patch, actorName(current)),
        username: actorName(current),
        actorId: current.authId,
        actorEmail: current.email,
      });
    });
  }

  revalidatePath(`/ats/${personId}`);
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteInterview(
  personId: string,
  interviewId: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("person_interview")
    .delete()
    .eq("id", interviewId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/ats/${personId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Slack — post candidate / interview summaries to the hiring channel.
//
// The summary text is rebuilt server-side from the database rather than taken
// from the client, and the channel comes from an allow-listed key, so a caller
// can only ever post the real summary to a configured channel.
// ---------------------------------------------------------------------------

async function loadCandidateRow(personId: string): Promise<CandidateRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("person")
    .select(
      `id, status, first_name, last_name, full_name, email, phone_mobile,
       phone_home, phone_other, date_of_birth, postal_code, opportunity_type,
       notes, source_contact_id, created_at, updated_at,
       person_recruiting (
         person_id, target_position_id, pipeline, stage, status_notes, source,
         application_date, interview_date, score, resume_url, keep_for_future,
         follow_up_date, notes, target_title, candidate_location,
         relevant_experience, education, job_location, interest_level,
         external_status, source_detail, screening_answers, application_history,
         slack_announce_ts, slack_announce_channel, announced_at, announced_by,
         created_at, updated_at
       )`,
    )
    .eq("id", personId)
    .maybeSingle();
  if (!data) return null;

  const rec = (data as { person_recruiting?: unknown }).person_recruiting;
  return {
    ...data,
    person_recruiting: Array.isArray(rec) ? (rec[0] ?? null) : (rec ?? null),
  } as CandidateRow;
}

async function postSummary(
  personId: string,
  kind: "candidate" | "interview",
  build: (row: CandidateRow) => Promise<string | null>,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;

  const row = await loadCandidateRow(personId);
  if (!row) return { ok: false, error: "Candidate not found." };

  const text = await build(row);
  if (!text) return { ok: false, error: "Nothing to post." };

  const { appUser, email } = gate.current;
  const result = await postSlackMessage({
    channelKey: "hiring",
    text,
    username: appUser.full_name ?? email.split("@")[0],
    threadTs: row.person_recruiting?.slack_announce_ts ?? undefined,
  });
  if (!result.ok) return { ok: false, error: result.error ?? "Slack post failed." };

  await recordAudit({
    actorId: appUser.id,
    actorEmail: email,
    action: "slack.post",
    entity: "person",
    entityId: personId,
    summary: `Posted ${kind} summary to Slack`,
    metadata: { channel: result.channel, ts: result.ts },
  });
  return { ok: true };
}

/**
 * Post the candidate announcement (the team's numbered format, @channel) and
 * remember its ts so later stage changes and interviews reply in its thread.
 * Each candidate is announced once.
 */
export async function announceCandidate(personId: string): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  return postAnnouncement(personId, gate.current);
}

async function postAnnouncement(personId: string, current: CurrentUser): Promise<SaveResult> {
  if (!isSlackConfigured()) {
    return { ok: false, error: "Slack isn't configured (SLACK_BOT_TOKEN is not set)." };
  }

  const row = await loadCandidateRow(personId);
  if (!row) return { ok: false, error: "Candidate not found." };
  if (row.person_recruiting?.slack_announce_ts) {
    return {
      ok: false,
      error: "Already announced — updates reply in the original Slack thread.",
    };
  }

  // Resume link: the explicit URL if one was entered, else the newest uploaded
  // resume (signed for a week so the link still works when the team reads it).
  let resumeLink = row.person_recruiting?.resume_url ?? null;
  if (!resumeLink) {
    const admin = createAdminClient();
    const { data: doc } = await admin
      .from("person_document")
      .select("storage_path")
      .eq("person_id", personId)
      .ilike("category", "resume")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const path = (doc as { storage_path?: string } | null)?.storage_path;
    if (path) {
      const { data: signed } = await admin.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      resumeLink = signed?.signedUrl ?? null;
    }
  }

  const { appUser, email, authId } = current;
  const result = await postSlackMessage({
    channelKey: "hiring",
    text: buildAnnouncementMessage(row, resumeLink, candidateProfileUrl(personId)),
    username: actorName(current),
  });
  if (!result.ok) return { ok: false, error: result.error ?? "Slack post failed." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("person_recruiting")
    .upsert(
      {
        person_id: personId,
        slack_announce_ts: result.ts ?? null,
        slack_announce_channel: result.channel ?? null,
        announced_at: new Date().toISOString(),
        announced_by: authId,
      },
      { onConflict: "person_id" },
    );

  await recordAudit({
    actorId: appUser.id,
    actorEmail: email,
    action: "slack.post",
    entity: "person",
    entityId: personId,
    summary: "Announced candidate in Slack",
    metadata: { channel: result.channel, ts: result.ts },
  });

  revalidatePath(`/ats/${personId}`);
  revalidatePath("/ats");
  if (error) {
    return { ok: false, error: `Posted to Slack, but couldn't save the thread link: ${error.message}` };
  }
  return { ok: true };
}

export async function postInterviewSummaryToSlack(
  personId: string,
  interviewId: string,
): Promise<SaveResult> {
  return postSummary(personId, "interview", async (row) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("person_interview")
      .select("*")
      .eq("id", interviewId)
      .eq("person_id", personId)
      .maybeSingle();
    if (!data) return null;
    return buildInterviewSummary(row, data as PersonInterview);
  });
}

// ---------------------------------------------------------------------------
// Documents (attachments) — stored on the SAME person_document rows / bucket
// (employee-documents) that HR reads, so anything uploaded here follows the
// candidate straight into the HR/Roster view once they are hired.
// ---------------------------------------------------------------------------
const DOCUMENTS_BUCKET = "employee-documents";

/**
 * Store an uploaded file on a person's document shelf (the shared
 * `employee-documents` bucket + `person_document` row that HR also reads).
 * Rolls back the storage object if the row insert fails so the two stay in
 * sync. Used by both the manual "upload document" action and the resume-import
 * flow, which attaches the original resume to the new candidate.
 */
async function storePersonDocument(
  personId: string,
  file: File,
  meta: { title?: string | null; category?: string | null; source?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const storagePath = `${personId}/${Date.now()}_${safeName}`;

  const { error: upErr } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) return { ok: false, error: upErr.message };

  const { error: dbErr } = await admin.from("person_document").insert({
    person_id: personId,
    title: meta.title ?? file.name,
    category: meta.category ?? guessDocumentCategory(file.name, "other"),
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    source: meta.source ?? "Uploaded in ATS",
  });
  if (dbErr) {
    // Roll back the orphaned upload so storage and the table stay in sync.
    await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    return { ok: false, error: dbErr.message };
  }
  return { ok: true };
}

export async function uploadCandidateDocument(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose a file to upload." };
  }
  if (file.size > 25 * 1024 * 1024) {
    return { ok: false, error: "File exceeds the 25 MB limit." };
  }

  const stored = await storePersonDocument(personId, file, {
    title: str(formData.get("title")),
    category: str(formData.get("category")),
    source: "Uploaded in ATS",
  });
  if (!stored.ok) return stored;

  revalidatePath(`/ats/${personId}`);
  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

export async function deleteCandidateDocument(
  personId: string,
  documentId: string,
  storagePath: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const admin = createAdminClient();

  await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
  const { error } = await admin
    .from("person_document")
    .delete()
    .eq("id", documentId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/ats/${personId}`);
  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

/**
 * Fetch a candidate's attached documents (resumes, cover letters, etc.) with
 * short-lived signed download URLs. Used by the Review Queue's expandable tile
 * to show attachments on demand without generating signed URLs for the whole
 * queue up front. Read-gated to any signed-in user.
 */
export async function getCandidateDocuments(
  personId: string,
): Promise<
  | { ok: true; documents: CandidateDocument[] }
  | { ok: false; error: string }
> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "You are not signed in." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("person_document")
    .select("id, title, category, storage_path, file_name, mime_type, size_bytes, source, uploaded_at")
    .eq("person_id", personId)
    .order("uploaded_at", { ascending: false });
  if (error) return { ok: false, error: error.message };

  const docs = (data ?? []) as Array<{
    id: string;
    title: string;
    category: string | null;
    storage_path: string;
    file_name: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    source: string | null;
    uploaded_at: string;
  }>;
  if (docs.length === 0) return { ok: true, documents: [] };

  const { data: signed } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrls(
      docs.map((d) => d.storage_path),
      60 * 60,
    );

  const documents: CandidateDocument[] = docs.map((d, i) => ({
    id: d.id,
    title: d.title,
    category: d.category,
    file_name: d.file_name,
    mime_type: d.mime_type,
    size_bytes: d.size_bytes,
    source: d.source,
    uploaded_at: d.uploaded_at,
    signed_url: signed?.[i]?.signedUrl ?? null,
  }));

  return { ok: true, documents };
}

// Convert a candidate into an employee: flip status + seed an employment row.
// The person status trigger cascades the rest (scheduling eligibility, a
// schedule settings row, and any linked login account). Documents already live
// on the same person row, so they follow into the HR/Roster view automatically.
// The move is recorded in the profile transition log so the history travels
// with the profile.
export async function hireCandidate(personId: string): Promise<void> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) redirect(`/ats/${personId}`);
  const supabase = await createClient();

  // Capture the stage we're moving from (usually "applicant") for the log.
  const { data: before } = await supabase
    .from("person")
    .select("status")
    .eq("id", personId)
    .maybeSingle();
  const fromStage = (before as { status?: string } | null)?.status ?? null;

  await supabase
    .from("person")
    .update({ status: "employee", status_changed_at: new Date().toISOString() })
    .eq("id", personId);
  // Seed the employment row and stamp a hire date if one isn't set yet.
  const today = new Date().toISOString().slice(0, 10);
  // The position they were recruited for carries over unless HR already set one.
  const [{ data: emp }, { data: recRow }] = await Promise.all([
    supabase
      .from("person_employment")
      .select("hire_date, position_id")
      .eq("person_id", personId)
      .maybeSingle(),
    supabase
      .from("person_recruiting")
      .select("target_position_id")
      .eq("person_id", personId)
      .maybeSingle(),
  ]);
  const existing = emp as { hire_date?: string | null; position_id?: string | null } | null;
  await supabase.from("person_employment").upsert(
    {
      person_id: personId,
      hire_date: existing?.hire_date ?? today,
      position_id:
        existing?.position_id ??
        (recRow as { target_position_id?: string | null } | null)?.target_position_id ??
        null,
    },
    { onConflict: "person_id" },
  );

  // ATS graduation to roster should create an auth login when eligible.
  await ensureAuthUserForPerson(personId);

  const current = await getCurrentUser();
  await logProfileTransition({
    personId,
    eventType: "hired_to_roster",
    fromStage,
    toStage: "employee",
    detail: "Candidate hired to the roster",
    actorId: current?.authId ?? null,
    actorName: current?.appUser.full_name ?? current?.email ?? null,
  });

  if (isSlackConfigured()) {
    after(async () => {
      const admin = createAdminClient();
      const { data } = await admin
        .from("person")
        .select("full_name, first_name, last_name")
        .eq("id", personId)
        .maybeSingle();
      if (!data) return;
      const by = current ? actorName(current) : null;
      await notifyCandidateThread({
        personId,
        text: `🎉 *${esc(candidateName(data))}* was hired${by ? ` — ${esc(by)}` : ""}`,
        username: by,
        actorId: current?.authId ?? null,
        actorEmail: current?.email ?? null,
      });
    });
  }

  revalidatePath(`/ats/${personId}`);
  revalidatePath(`/hr/${personId}`);
  revalidatePath("/ats");
  revalidatePath("/hr");
  revalidatePath("/schedule");
  revalidatePath("/schedule/setup");
  redirect(`/hr/${personId}`);
}

// Permanently delete a candidate record. Admin/owner only.
export async function deleteCandidate(personId: string): Promise<void> {
  const current = await getCurrentUser();
  if (!current || !isAdminRole(current.appUser.role)) {
    redirect("/ats");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("person").delete().eq("id", personId);
  if (error) {
    throw new Error(`Could not delete candidate: ${error.message}`);
  }

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "delete",
    entity: "person",
    entityId: personId,
    summary: "Deleted recruiting candidate record",
  });

  revalidatePath("/ats");
  redirect("/ats");
}

// ---------------------------------------------------------------------------
// Intake review queue — accept / reject auto-ingested applicants
// (Gmail poller + Indeed webhook). Pending applicants land in the Review tab;
// accepting promotes them to an active lead, rejecting marks them Declined but
// keeps the record for re-apply detection.
// ---------------------------------------------------------------------------

async function setReviewStatus(
  personId: string,
  reviewStatus: "accepted" | "declined",
  stage: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const fromStage = await currentStage(personId);
  const { error } = await supabase
    .from("person_recruiting")
    .update({
      review_status: reviewStatus,
      stage,
      reviewed_at: new Date().toISOString(),
      reviewed_by: gate.current.authId,
    })
    .eq("person_id", personId);
  if (error) return { ok: false, error: error.message };

  // History only here — an accepted applicant is announced in Slack by
  // acceptCandidate once the status change has landed.
  await logProfileTransition({
    personId,
    eventType: "review_triage",
    fromStage,
    toStage: stage,
    detail: reviewStatus === "accepted" ? "Accepted from the review queue" : "Declined from the review queue",
    actorId: gate.current.authId,
    actorName: actorName(gate.current),
  });

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "update",
    entity: "person",
    entityId: personId,
    summary: reviewStatus === "accepted" ? "Accepted applicant into pipeline" : "Declined applicant",
  });

  revalidatePath("/ats");
  revalidatePath(`/ats/${personId}`);
  return { ok: true };
}

/**
 * Accept a pending applicant: promote to an active lead in the pipeline and
 * announce them in the Slack hiring channel (summary + profile link). A Slack
 * failure doesn't undo the accept — the profile's Announce button stays
 * available to retry.
 */
export async function acceptCandidate(personId: string): Promise<SaveResult> {
  const result = await setReviewStatus(personId, "accepted", ACCEPTED_LEAD_STAGE);
  if (!result.ok || !isSlackConfigured()) return result;

  const current = await getCurrentUser();
  if (!current) return result;
  const announced = await postAnnouncement(personId, current);
  if (!announced.ok) {
    console.error("[ats] auto-announce on accept failed:", announced.error);
  }
  return result;
}

/** Reject a pending applicant: mark Declined but keep for re-apply detection. */
export async function declineCandidate(personId: string): Promise<SaveResult> {
  return setReviewStatus(personId, "declined", DECLINED_STAGE);
}

// ---------------------------------------------------------------------------
// Candidate import — list (CSV/Excel/PDF) and single-resume (any format)
// ---------------------------------------------------------------------------

const MAX_IMPORT_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Parse an uploaded list of candidates (CSV / XLS / XLSX, or a PDF/image
 * roster) into structured rows for review. Nothing is written here — the
 * client reviews/edits the rows and then calls `createCandidates`.
 */
export async function parseCandidateList(formData: FormData): Promise<ParseListResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return { ok: false, error: gate.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was uploaded." };
  if (file.size === 0) return { ok: false, error: "The uploaded file is empty." };
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, error: "File too large (max 15 MB)." };
  }

  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  const isSpreadsheet = /\.(csv|xls|xlsx)$/.test(name) || file.type.includes("spreadsheet");
  const isPdfOrImage =
    name.endsWith(".pdf") || file.type === "application/pdf" || file.type.startsWith("image/");

  if (isSpreadsheet) {
    try {
      const rows = workbookToRows(buffer);
      const { candidates, warnings } = rowsToCandidates(rows);
      if (!candidates.length) {
        return {
          ok: false,
          error: warnings[0] ?? "No candidates were found in the file.",
        };
      }
      return { ok: true, candidates, warnings };
    } catch {
      return { ok: false, error: "Could not read the spreadsheet. Check the file and try again." };
    }
  }

  if (isPdfOrImage) {
    const result = await extractListCandidates(file.name, file.type, buffer);
    if (!result.ok) return result;
    return { ok: true, candidates: result.candidates, warnings: [] };
  }

  return {
    ok: false,
    error: "Unsupported file type. Upload a CSV, Excel, PDF, or image file.",
  };
}

/**
 * Parse a single uploaded resume (PDF, Word, image, or text) into one
 * candidate using the configured LLM. Returns the extracted fields for review.
 */
export async function parseResumeFile(formData: FormData): Promise<ParseResumeResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return { ok: false, error: gate.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was uploaded." };
  if (file.size === 0) return { ok: false, error: "The uploaded file is empty." };
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, error: "File too large (max 15 MB)." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await extractResumeCandidate(file.name, file.type, buffer);
  if (!result.ok) return result;
  return { ok: true, candidate: result.candidate };
}

/**
 * Create recruiting candidates from reviewed rows. Each becomes a `person`
 * (status = applicant) plus a `person_recruiting` row. Blank fields are left
 * for manual entry. Partial success is reported per-row.
 */
export async function createCandidates(
  candidates: ParsedCandidate[],
): Promise<CreateCandidatesResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();

  const valid = candidates.filter(candidateHasIdentity);
  if (!valid.length) {
    return { ok: false, error: "No candidates with a name or email to create." };
  }

  let created = 0;
  let failed = 0;
  const errors: string[] = [];
  // Default intake date for anything the upload didn't carry: the upload day.
  const uploadedOn = new Date().toISOString().slice(0, 10);

  for (const c of valid) {
    const label =
      c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "candidate";
    const fullName =
      c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || null;

    const { data: person, error: pErr } = await supabase
      .from("person")
      .insert({
        status: "applicant",
        first_name: c.first_name,
        last_name: c.last_name,
        full_name: fullName,
        email: c.email,
        phone_mobile: c.phone_mobile,
        phone_home: c.phone_home,
        phone_other: c.phone_other,
        date_of_birth: c.date_of_birth,
        postal_code: c.postal_code,
        opportunity_type: c.opportunity_type,
        notes: c.notes,
      })
      .select("id")
      .single();

    if (pErr || !person) {
      failed++;
      errors.push(`${label}: ${pErr?.message ?? "could not create person"}`);
      continue;
    }

    // Every applicant gets a recruiting row so the intake (application) date is
    // always recorded, even when no other recruiting field was provided.
    const { error: rErr } = await supabase.from("person_recruiting").upsert(
      {
        person_id: person.id,
        target_title: normalizePositionTitle(c.target_title),
        pipeline: normalizePipeline(c.pipeline),
        stage: normalizeStage(c.stage),
        source: normalizeSource(c.source),
        source_detail: c.source_detail,
        score: c.score,
        application_date: c.application_date ?? uploadedOn,
        candidate_location: await cityOrZipLookup(c.candidate_location, c.postal_code),
        relevant_experience: c.relevant_experience,
        education: c.education,
        job_location: normalizeJobLocation(c.job_location),
        interest_level: c.interest_level,
        status_notes: c.status_notes,
      },
      { onConflict: "person_id" },
    );
    if (rErr) errors.push(`${label}: saved, but recruiting details failed (${rErr.message}).`);

    created++;
  }

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "import",
    entity: "person",
    summary: `Imported ${created} recruiting candidate${created === 1 ? "" : "s"}`,
    metadata: { created, failed },
  });

  revalidatePath("/ats");
  return { ok: true, created, failed, errors };
}

export type CreateResumeCandidateResult =
  | { ok: true; id: string; documentSaved: boolean; documentError?: string }
  | { ok: false; error: string };

/**
 * Create one recruiting candidate from a parsed+reviewed resume and attach the
 * original resume file to that person's document shelf (Documents tab). The
 * candidate is created first; if the file upload then fails the candidate is
 * still kept and the failure is reported so the recruiter can re-attach it.
 */
export async function createResumeCandidate(
  candidate: ParsedCandidate,
  file: File | null,
): Promise<CreateResumeCandidateResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!candidateHasIdentity(candidate)) {
    return { ok: false, error: "Enter a name or email before creating the candidate." };
  }
  if (file && file.size > 25 * 1024 * 1024) {
    return { ok: false, error: "Resume file exceeds the 25 MB limit." };
  }

  const supabase = await createClient();
  const uploadedOn = new Date().toISOString().slice(0, 10);
  const fullName =
    candidate.full_name ||
    [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") ||
    null;

  const { data: person, error: pErr } = await supabase
    .from("person")
    .insert({
      status: "applicant",
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      full_name: fullName,
      email: candidate.email,
      phone_mobile: candidate.phone_mobile,
      phone_home: candidate.phone_home,
      phone_other: candidate.phone_other,
      date_of_birth: candidate.date_of_birth,
      postal_code: candidate.postal_code,
      opportunity_type: candidate.opportunity_type,
      notes: candidate.notes,
    })
    .select("id")
    .single();
  if (pErr || !person) {
    return { ok: false, error: pErr?.message ?? "Could not create candidate." };
  }

  const { error: rErr } = await supabase.from("person_recruiting").upsert(
    {
      person_id: person.id,
      target_title: normalizePositionTitle(candidate.target_title),
      pipeline: normalizePipeline(candidate.pipeline),
      stage: normalizeStage(candidate.stage),
      source: normalizeSource(candidate.source),
      source_detail: candidate.source_detail,
      score: candidate.score,
      application_date: candidate.application_date ?? uploadedOn,
      candidate_location: await cityOrZipLookup(
        candidate.candidate_location,
        candidate.postal_code,
      ),
      relevant_experience: candidate.relevant_experience,
      education: candidate.education,
      job_location: normalizeJobLocation(candidate.job_location),
      interest_level: candidate.interest_level,
      status_notes: candidate.status_notes,
    },
    { onConflict: "person_id" },
  );

  let documentSaved = false;
  let documentError: string | undefined;
  if (file && file.size > 0) {
    const stored = await storePersonDocument(person.id, file, {
      title: file.name,
      category: guessDocumentCategory(file.name, "resume"),
      source: "Resume upload (ATS)",
    });
    documentSaved = stored.ok;
    if (!stored.ok) documentError = stored.error;
  }

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "create",
    entity: "person",
    entityId: person.id,
    summary: `Added recruiting candidate ${fullName ?? candidate.email ?? person.id} from resume`,
  });

  revalidatePath("/ats");
  revalidatePath(`/ats/${person.id}`);
  return {
    ok: true,
    id: person.id,
    documentSaved,
    documentError: documentError ?? (rErr ? `Recruiting details: ${rErr.message}` : undefined),
  };
}

export type CreateCandidateResult =
  | { ok: true; id: string; warning?: string }
  | { ok: false; error: string };

/**
 * Create a single recruiting candidate from a manual entry form. Inserts a
 * `person` (status = applicant) plus, when any recruiting field is provided, a
 * `person_recruiting` row, and attaches any uploaded documents (resume, cover
 * letter, …) to the candidate's Documents tab. Returns the new person id so the
 * caller can open the candidate detail view.
 */
export async function createCandidate(
  formData: FormData,
): Promise<CreateCandidateResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const firstName = str(formData.get("first_name"));
  const lastName = str(formData.get("last_name"));
  const email = str(formData.get("email"));
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;

  if (!firstName && !lastName && !email) {
    return { ok: false, error: "Enter a name or email to create a candidate." };
  }

  const documents = formData
    .getAll("documents")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const tooBig = documents.find((f) => f.size > 25 * 1024 * 1024);
  if (tooBig) return { ok: false, error: `${tooBig.name} exceeds the 25 MB limit.` };

  const postalCode = str(formData.get("postal_code"));
  const { data: person, error: pErr } = await supabase
    .from("person")
    .insert({
      status: "applicant",
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      email,
      phone_mobile: phone(formData.get("phone_mobile")),
      phone_home: phone(formData.get("phone_home")),
      phone_other: phone(formData.get("phone_other")),
      date_of_birth: str(formData.get("date_of_birth")),
      postal_code: postalCode,
      opportunity_type: str(formData.get("opportunity_type")),
    })
    .select("id")
    .single();

  if (pErr || !person) {
    return { ok: false, error: pErr?.message ?? "Could not create candidate." };
  }

  const recPatch = {
    person_id: person.id,
    target_position_id: str(formData.get("target_position_id")),
    target_title: normalizePositionTitle(str(formData.get("target_title"))),
    candidate_location: await cityOrZipLookup(str(formData.get("candidate_location")), postalCode),
    pipeline: normalizePipeline(str(formData.get("pipeline"))),
    stage: normalizeStage(str(formData.get("stage"))),
    source: normalizeSource(str(formData.get("source"))),
    application_date: str(formData.get("application_date")),
    interview_date: str(formData.get("interview_date")),
    score: num(formData.get("score")),
    keep_for_future: bool(formData.get("keep_for_future")),
    follow_up_date: str(formData.get("follow_up_date")),
    status_notes: str(formData.get("status_notes")),
    notes: str(formData.get("notes")),
  };
  const hasRecruiting = Object.entries(recPatch).some(
    ([k, v]) => k !== "person_id" && v != null && v !== false,
  );
  if (hasRecruiting) {
    const { error: rErr } = await supabase
      .from("person_recruiting")
      .upsert(recPatch, { onConflict: "person_id" });
    if (rErr) {
      return { ok: false, error: `Candidate saved, but recruiting details failed: ${rErr.message}` };
    }
  }

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "create",
    entity: "person",
    entityId: person.id,
    summary: `Added recruiting candidate ${fullName ?? email ?? person.id}`,
  });

  // The candidate exists either way; a failed attachment is reported so the
  // recruiter can re-upload it from the Documents tab.
  const failedDocs: string[] = [];
  for (const file of documents) {
    const stored = await storePersonDocument(person.id, file, {
      title: file.name,
      category: guessDocumentCategory(file.name, documents.length === 1 ? "resume" : "other"),
      source: "Uploaded in ATS",
    });
    if (!stored.ok) failedDocs.push(`${file.name} (${stored.error})`);
  }

  revalidatePath("/ats");
  revalidatePath(`/ats/${person.id}`);
  return {
    ok: true,
    id: person.id,
    ...(failedDocs.length
      ? {
          warning: `Candidate saved, but these documents failed to attach: ${failedDocs.join(", ")}. Re-upload them from the Documents tab.`,
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Activity log (calls / texts / emails / notes) and follow-up tasks. In-app
// only — these never post to Slack.
// ---------------------------------------------------------------------------

export async function addRecruitingActivity(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;

  const body = str(formData.get("body"));
  if (!body) return { ok: false, error: "Write what happened." };
  const type = str(formData.get("activity_type")) ?? "note";
  if (!(type in ACTIVITY_TYPE_LABELS)) return { ok: false, error: "Unknown activity type." };
  const occurredAt = str(formData.get("occurred_at"));

  const supabase = await createClient();
  const { error } = await supabase.from("recruiting_activity").insert({
    person_id: personId,
    activity_type: type,
    body,
    ...(occurredAt ? { occurred_at: new Date(occurredAt).toISOString() } : {}),
    created_by: gate.current.authId,
    created_by_name: actorName(gate.current),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/ats/${personId}`);
  return { ok: true };
}

export async function deleteRecruitingActivity(
  personId: string,
  activityId: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("recruiting_activity")
    .delete()
    .eq("id", activityId)
    .eq("person_id", personId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/ats/${personId}`);
  return { ok: true };
}

export async function addRecruitingTask(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;

  const title = str(formData.get("title"));
  if (!title) return { ok: false, error: "Give the follow-up a title." };

  const supabase = await createClient();
  const { error } = await supabase.from("recruiting_task").insert({
    person_id: personId,
    title,
    details: str(formData.get("details")),
    due_date: str(formData.get("due_date")),
    created_by: gate.current.authId,
    created_by_name: actorName(gate.current),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/ats/${personId}`);
  revalidatePath("/ats");
  return { ok: true };
}

export async function toggleRecruitingTask(
  personId: string,
  taskId: string,
  done: boolean,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("recruiting_task")
    .update({ is_done: done, completed_at: done ? new Date().toISOString() : null })
    .eq("id", taskId)
    .eq("person_id", personId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/ats/${personId}`);
  revalidatePath("/ats");
  return { ok: true };
}

export async function deleteRecruitingTask(
  personId: string,
  taskId: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("recruiting_task")
    .delete()
    .eq("id", taskId)
    .eq("person_id", personId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/ats/${personId}`);
  revalidatePath("/ats");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Open positions board — the hiring needs the team used to track in a Slack
// canvas ("need another Van Nuys CSR", "MyPet truck tech top priority").
// Rows live on the shared `position` table, which HR also references by id.
// ---------------------------------------------------------------------------

export async function savePosition(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;

  const id = str(formData.get("position_id"));
  const priority = str(formData.get("priority")) ?? "normal";
  const status = str(formData.get("status")) ?? "open";
  if (!(priority in POSITION_PRIORITY_LABELS)) return { ok: false, error: "Unknown priority." };
  if (!(status in POSITION_STATUS_LABELS)) return { ok: false, error: "Unknown status." };
  const openings = Math.max(1, Math.round(num(formData.get("openings")) ?? 1));

  const employmentType = str(formData.get("employment_type"));
  if (employmentType && !(employmentType in POSITION_EMPLOYMENT_LABELS)) {
    return { ok: false, error: "Unknown employment type." };
  }
  const workLocationType = str(formData.get("work_location_type"));
  if (workLocationType && !(workLocationType in POSITION_WORK_LOCATION_LABELS)) {
    return { ok: false, error: "Unknown work setting." };
  }
  const daysNeeded = [
    ...new Set(
      formData
        .getAll("days_needed")
        .map((value) => Number(value))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    ),
  ].sort((a, b) => a - b);
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
  const shiftStart = str(formData.get("shift_start"));
  const shiftEnd = str(formData.get("shift_end"));
  if ((shiftStart && !timePattern.test(shiftStart)) || (shiftEnd && !timePattern.test(shiftEnd))) {
    return { ok: false, error: "Enter shift times as HH:MM." };
  }
  const hoursPerWeek = num(formData.get("hours_per_week"));
  if (hoursPerWeek !== null && (hoursPerWeek <= 0 || hoursPerWeek > 80)) {
    return { ok: false, error: "Hours per week must be between 1 and 80." };
  }
  const payMin = num(formData.get("pay_min"));
  const payMax = num(formData.get("pay_max"));
  if ((payMin !== null && payMin < 0) || (payMax !== null && payMax < 0)) {
    return { ok: false, error: "Pay can't be negative." };
  }
  if (payMin !== null && payMax !== null && payMin > payMax) {
    return { ok: false, error: "Minimum pay can't be higher than maximum pay." };
  }
  const hasPay = payMin !== null || payMax !== null;
  const payTypeInput = str(formData.get("pay_type"));
  if (payTypeInput && !(payTypeInput in POSITION_PAY_TYPE_LABELS)) {
    return { ok: false, error: "Unknown pay type." };
  }
  const payType = hasPay ? (payTypeInput ?? "hourly") : null;
  const targetStartDate = str(formData.get("target_start_date"));
  if (targetStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetStartDate)) {
    return { ok: false, error: "Enter a valid start date." };
  }
  const details = {
    employment_type: employmentType,
    days_needed: daysNeeded,
    shift_start: shiftStart,
    shift_end: shiftEnd,
    hours_per_week: hoursPerWeek,
    work_location_type: workLocationType,
    pay_min: payMin,
    pay_max: payMax,
    pay_type: payType,
    target_start_date: targetStartDate,
    description: str(formData.get("description")),
    requirements: str(formData.get("requirements")),
  };
  const supabase = await createClient();

  const currentPosition = id
    ? await supabase
        .from("position")
        .select("title, location")
        .eq("id", id)
        .maybeSingle()
    : null;
  if (currentPosition?.error) {
    return { ok: false, error: currentPosition.error.message };
  }
  if (id && !currentPosition?.data) {
    return { ok: false, error: "The position being edited could not be found." };
  }

  const roleValues = id
    ? [str(formData.get("role_id"))].filter((value): value is string => value !== null)
    : formData
        .getAll("role_ids")
        .map((value) => String(value).trim())
        .filter(Boolean);
  const locationValues = id
    ? [str(formData.get("location_id")) ?? ""]
    : formData
        .getAll("location_ids")
        .map((value) => String(value).trim())
        .filter(Boolean);

  if (roleValues.length === 0) {
    return { ok: false, error: "Select at least one system role." };
  }
  if (locationValues.length === 0) {
    return { ok: false, error: "Select at least one clinic location." };
  }

  const roleIds = roleValues.filter((value) => value !== "__current_role__");
  const locationIds = locationValues.filter(
    (value) => value !== "" && value !== "__current_location__",
  );
  const roleNames = new Map<string, string>();
  if (roleIds.length > 0) {
    const { data, error } = await supabase
      .from("sched_role")
      .select("id, name")
      .in("id", roleIds)
      .eq("is_active", true);
    if (error) return { ok: false, error: error.message };
    for (const role of data ?? []) roleNames.set(role.id, role.name);
  }
  const locationNames = new Map<string, string>();
  if (locationIds.length > 0) {
    const { data, error } = await supabase
      .from("location")
      .select("id, name")
      .in("id", locationIds)
      .eq("is_active", true)
      .eq("kind", "clinic");
    if (error) return { ok: false, error: error.message };
    for (const location of data ?? []) locationNames.set(location.id, location.name);
  }

  const current = currentPosition?.data;
  const titles = roleValues.map((value) => {
    if (value === "__current_role__" && id && current) return current.title;
    return roleNames.get(value) ?? null;
  });
  const locations = locationValues.map((value) => {
    if (value === "__current_location__" && id && current) return current.location;
    if (value === "") return null;
    return locationNames.get(value) ?? null;
  });
  if (titles.some((title) => !title)) {
    return { ok: false, error: "Select roles from the active system role list." };
  }
  if (locations.some((location, index) => location === null && locationValues[index] !== "")) {
    return { ok: false, error: "Select clinic locations from the active location list." };
  }
  if (id && (titles.length !== 1 || locations.length !== 1)) {
    return { ok: false, error: "Edit one position at a time." };
  }
  if (!id && locations.some((location) => location === null)) {
    return { ok: false, error: "Select clinic locations from the active location list." };
  }

  const selectedTitles = titles.filter(
    (title): title is string => title !== null,
  );
  const notes = str(formData.get("notes"));
  const records = selectedTitles.flatMap((title) =>
    locations.map((location) => ({
      title,
      location,
      priority,
      status,
      openings,
      notes,
      ...details,
    })),
  );

  const result = id
    ? await supabase.from("position").update(records[0]).eq("id", id)
    : await supabase.from("position").insert(records);
  if (result.error) {
    if (result.error.code === "23505") {
      return {
        ok: false,
        error: "One or more selected role and location combinations already exist.",
      };
    }
    return { ok: false, error: result.error.message };
  }

  const summary =
    id
      ? `Updated position ${records[0].title}${records[0].location ? ` (${records[0].location})` : ""}`
      : `Opened ${records.length} position${records.length === 1 ? "" : "s"} for ${selectedTitles.join(", ")} at ${locations.join(", ")}`;
  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: id ? "update" : "create",
    entity: "position",
    entityId: id ?? undefined,
    summary,
  });

  revalidatePath("/ats");
  return { ok: true };
}

export async function setPositionStatus(
  positionId: string,
  status: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  if (!(status in POSITION_STATUS_LABELS)) return { ok: false, error: "Unknown status." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("position")
    .update({ status })
    .eq("id", positionId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/ats");
  return { ok: true };
}

/**
 * Admin only, and only for positions nobody is linked to — `position` is shared
 * with HR (person_employment.position_id), so deleting a used one would blank
 * employees' positions. Close it instead.
 */
export async function deletePosition(positionId: string): Promise<SaveResult> {
  const current = await getCurrentUser();
  if (!current || !isAdminRole(current.appUser.role)) {
    return { ok: false, error: "Only an admin can delete a position. Close it instead." };
  }
  const supabase = await createClient();
  const [{ count: employees }, { count: candidates }] = await Promise.all([
    supabase
      .from("person_employment")
      .select("person_id", { count: "exact", head: true })
      .eq("position_id", positionId),
    supabase
      .from("person_recruiting")
      .select("person_id", { count: "exact", head: true })
      .eq("target_position_id", positionId),
  ]);
  if ((employees ?? 0) > 0 || (candidates ?? 0) > 0) {
    return {
      ok: false,
      error: `This position is linked to ${employees ?? 0} employee(s) and ${candidates ?? 0} candidate(s). Mark it Closed instead.`,
    };
  }
  const { error } = await supabase.from("position").delete().eq("id", positionId);
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "delete",
    entity: "position",
    entityId: positionId,
    summary: "Deleted position",
  });
  revalidatePath("/ats");
  return { ok: true };
}
