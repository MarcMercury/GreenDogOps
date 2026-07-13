"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, ensureCanEdit, recordAudit } from "@/lib/auth/session";
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
import { ACCEPTED_LEAD_STAGE, DECLINED_STAGE, type CandidateDocument } from "@/lib/ats/types";

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

export type SaveResult = { ok: true } | { ok: false; error: string };

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
    phone_mobile: str(formData.get("phone_mobile")),
    phone_home: str(formData.get("phone_home")),
    phone_other: str(formData.get("phone_other")),
    date_of_birth: str(formData.get("date_of_birth")),
    postal_code: str(formData.get("postal_code")),
    opportunity_type: str(formData.get("opportunity_type")),
  };
  const { error: pErr } = await supabase
    .from("person")
    .update(personPatch)
    .eq("id", personId);
  if (pErr) return { ok: false, error: pErr.message };

  const recPatch = {
    person_id: personId,
    pipeline: str(formData.get("pipeline")),
    stage: str(formData.get("stage")),
    target_title: str(formData.get("target_title")),
    source: str(formData.get("source")),
    application_date: str(formData.get("application_date")),
    interview_date: str(formData.get("interview_date")),
    score: num(formData.get("score")),
    resume_url: str(formData.get("resume_url")),
    keep_for_future: bool(formData.get("keep_for_future")),
    follow_up_date: str(formData.get("follow_up_date")),
    status_notes: str(formData.get("status_notes")),
    notes: str(formData.get("notes")),
  };
  const { error: rErr } = await supabase
    .from("person_recruiting")
    .upsert(recPatch, { onConflict: "person_id" });
  if (rErr) return { ok: false, error: rErr.message };

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
  };

  const { error } = id
    ? await supabase.from("person_interview").update(patch).eq("id", id)
    : await supabase.from("person_interview").insert(patch);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/ats/${personId}`);
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
    category: meta.category ?? null,
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
  const { data: emp } = await supabase
    .from("person_employment")
    .select("hire_date")
    .eq("person_id", personId)
    .maybeSingle();
  await supabase.from("person_employment").upsert(
    {
      person_id: personId,
      hire_date: (emp as { hire_date?: string | null } | null)?.hire_date ?? today,
    },
    { onConflict: "person_id" },
  );

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

/** Accept a pending applicant: promote to an active lead in the pipeline. */
export async function acceptCandidate(personId: string): Promise<SaveResult> {
  return setReviewStatus(personId, "accepted", ACCEPTED_LEAD_STAGE);
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
        target_title: c.target_title,
        pipeline: c.pipeline,
        stage: c.stage,
        source: c.source,
        score: c.score,
        application_date: c.application_date ?? uploadedOn,
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
      target_title: candidate.target_title,
      pipeline: candidate.pipeline,
      stage: candidate.stage,
      source: candidate.source,
      score: candidate.score,
      application_date: candidate.application_date ?? uploadedOn,
      status_notes: candidate.status_notes,
    },
    { onConflict: "person_id" },
  );

  let documentSaved = false;
  let documentError: string | undefined;
  if (file && file.size > 0) {
    const stored = await storePersonDocument(person.id, file, {
      title: file.name,
      category: "Resume",
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
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Create a single recruiting candidate from a manual entry form. Inserts a
 * `person` (status = applicant) plus, when any recruiting field is provided, a
 * `person_recruiting` row. Returns the new person id so the caller can open the
 * candidate detail view.
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

  const { data: person, error: pErr } = await supabase
    .from("person")
    .insert({
      status: "applicant",
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      email,
      phone_mobile: str(formData.get("phone_mobile")),
      phone_home: str(formData.get("phone_home")),
      phone_other: str(formData.get("phone_other")),
      date_of_birth: str(formData.get("date_of_birth")),
      postal_code: str(formData.get("postal_code")),
      opportunity_type: str(formData.get("opportunity_type")),
    })
    .select("id")
    .single();

  if (pErr || !person) {
    return { ok: false, error: pErr?.message ?? "Could not create candidate." };
  }

  const recPatch = {
    person_id: person.id,
    target_title: str(formData.get("target_title")),
    pipeline: str(formData.get("pipeline")),
    stage: str(formData.get("stage")),
    source: str(formData.get("source")),
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

  revalidatePath("/ats");
  return { ok: true, id: person.id };
}
