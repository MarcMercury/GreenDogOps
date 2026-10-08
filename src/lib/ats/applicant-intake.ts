import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPhoneNumber } from "@/lib/shared/phone";
import { normalizeJobLocation, normalizePositionTitle } from "./normalize";
import { jobRecruitingFields, matchOpenJob } from "./jobs";
import { positionLabel, type PositionRow } from "./types";
import { logProfileTransition } from "@/lib/shared/transition-log";
import { guessDocumentCategory } from "./document-category";
import { applicationHasData, type ApplicationDetails } from "./application";

// ---------------------------------------------------------------------------
// Shared applicant intake.
//
// Both the Indeed Apply webhook and the Gmail poller funnel new applicants
// through here so profile creation, de-duplication, and resume storage behave
// identically no matter where the application arrived from. Everything runs on
// the service-role admin client because these callers are machine-to-machine
// (authenticated by webhook signature / OAuth), not a signed-in user.
// ---------------------------------------------------------------------------

const DOCUMENTS_BUCKET = "employee-documents";
const DUPLICATE_WINDOW_DAYS = 120;

type Admin = ReturnType<typeof createAdminClient>;

export interface ApplicantInput {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  /** Lead source, e.g. "Indeed" or "GD Website". */
  source: string;
  /** Position applied for, when known. */
  targetTitle: string | null;
  /** Clinic / location applied to, when known. */
  jobLocation?: string | null;
  /** ISO date (yyyy-mm-dd) the application was received. */
  applicationDate: string;
  notes: string | null;
  postalCode?: string | null;
  /** Where the applicant lives, e.g. "Reseda, CA". */
  candidateLocation?: string | null;
  sourceDetail?: string | null;
  education?: string | null;
  relevantExperience?: string | null;
  /** Full website application (person_recruiting.application). */
  application?: ApplicationDetails | null;
}

/** Any file that came with an application (resume, cover letter, …). */
export interface ApplicantResume {
  fileName: string;
  contentType: string;
  buffer: Buffer;
  /** DOCUMENT_CATEGORY_LABELS key; guessed from the file name when omitted. */
  category?: string;
}

export type IntakeOutcome =
  | { status: "created"; personId: string }
  | { status: "reapplied"; personId: string }
  | { status: "duplicate" }
  | { status: "error"; error: string };

/** Split a full name into first / last when only a single name field exists. */
export function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/** Today as an ISO date string (yyyy-mm-dd). */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Wrap text the applicant typed into a form (cover letter, plain-text resume)
 * as a .txt document so it lands on the Documents tab with the other files.
 */
export function textDocument(
  fileName: string,
  text: string | null | undefined,
  category: string,
): ApplicantResume | null {
  const body = text?.trim();
  if (!body) return null;
  return {
    fileName,
    contentType: "text/plain; charset=utf-8",
    buffer: Buffer.from(body + "\n", "utf-8"),
    category,
  };
}

type JobRef = Pick<PositionRow, "id" | "title" | "location" | "status">;

/**
 * The open job this application is clearly for (role + clinic), so it lands in
 * the Review Queue already assigned. Ambiguous or unknown roles stay
 * unassigned for the recruiter to pick. Best-effort: a lookup failure never
 * blocks the intake.
 */
async function matchApplicationJob(admin: Admin, input: ApplicantInput): Promise<JobRef | null> {
  if (!input.targetTitle) return null;
  const { data, error } = await admin
    .from("position")
    .select("id, title, location, status")
    .eq("status", "open");
  if (error) {
    console.error("[ats] open jobs lookup failed:", error.message);
    return null;
  }
  return matchOpenJob(
    (data ?? []) as JobRef[],
    input.targetTitle,
    normalizeJobLocation(input.jobLocation ?? null),
  );
}

async function logAutoAssigned(personId: string, job: JobRef): Promise<void> {
  await logProfileTransition({
    personId,
    eventType: "job_change",
    toStage: positionLabel(job),
    detail: "Auto-assigned from the application",
  });
}

/**
 * Find a matching applicant that already arrived from the same source within
 * the duplicate window. Keys on email when present, otherwise on full name
 * (needed for Indeed email notifications, which never expose the applicant's
 * email). When a target title is supplied it must also match, so the same
 * person applying to different roles is not collapsed. Returns the matched
 * person id + its review status so callers can reopen a declined re-applicant.
 */
async function findExistingApplicant(
  admin: Admin,
  key: { email: string | null; fullName: string | null },
  source: string,
  targetTitle: string | null,
): Promise<{ personId: string; reviewStatus: string | null } | null> {
  const cutoff = new Date(
    Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  let query = admin
    .from("person")
    .select("id, created_at, person_recruiting(source, target_title, review_status)")
    .eq("status", "applicant")
    .gte("created_at", cutoff);

  if (key.email) query = query.eq("email", key.email);
  else if (key.fullName) query = query.ilike("full_name", key.fullName);
  else return null;

  const { data } = await query;

  for (const p of data ?? []) {
    const rec = (p as { person_recruiting?: unknown }).person_recruiting;
    const r = (Array.isArray(rec) ? rec[0] : rec) as
      | { source?: string | null; target_title?: string | null; review_status?: string | null }
      | null;
    if (r?.source !== source) continue;
    if (targetTitle && r?.target_title && r.target_title !== targetTitle) continue;
    return { personId: (p as { id: string }).id, reviewStatus: r?.review_status ?? null };
  }
  return null;
}

/**
 * Store an application document on the candidate's document shelf
 * (best-effort, non-fatal). Skips a file already on the shelf under the same
 * name and size, so a re-sent application doesn't stack duplicate copies.
 */
async function storeResume(admin: Admin, personId: string, resume: ApplicantResume): Promise<void> {
  if (resume.buffer.length === 0) return;
  const fileName = resume.fileName?.trim() || "resume";
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const contentType = resume.contentType || "application/octet-stream";

  const { data: existing } = await admin
    .from("person_document")
    .select("id")
    .eq("person_id", personId)
    .eq("file_name", fileName)
    .eq("size_bytes", resume.buffer.length)
    .limit(1);
  if (existing && existing.length > 0) return;

  const storagePath = `${personId}/${Date.now()}_${safeName}`;
  const { error: upErr } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, resume.buffer, { contentType, upsert: false });
  if (upErr) {
    console.error(`[ats] document upload failed for ${personId}:`, upErr.message);
    return;
  }

  const { error: dbErr } = await admin.from("person_document").insert({
    person_id: personId,
    title: fileName,
    category: resume.category ?? guessDocumentCategory(fileName, "resume"),
    storage_path: storagePath,
    file_name: fileName,
    mime_type: contentType,
    size_bytes: resume.buffer.length,
    source: "Inbound application",
  });
  if (dbErr) {
    console.error(`[ats] document record failed for ${personId}:`, dbErr.message);
    await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
  }
}

/**
 * Create a recruiting candidate (`person` status = applicant + a
 * `person_recruiting` row) and attach every document that came with the
 * application (resume, cover letter, …). De-duplicates against
 * recent applications from the same source. Requires at least an email or a
 * name (Indeed email notifications have a name but no email).
 */
export async function createApplicantProfile(
  rawInput: ApplicantInput,
  resumes: ApplicantResume[] = [],
): Promise<IntakeOutcome> {
  const input = { ...rawInput, targetTitle: normalizePositionTitle(rawInput.targetTitle) };
  let first = input.firstName;
  let last = input.lastName;
  if (!first && !last && input.fullName) {
    const split = splitName(input.fullName);
    first = split.first;
    last = split.last;
  }
  const fullName = input.fullName || [first, last].filter(Boolean).join(" ") || null;

  if (!input.email && !fullName) {
    return { status: "error", error: "Missing applicant email and name." };
  }

  const admin = createAdminClient();

  const existing = await findExistingApplicant(
    admin,
    { email: input.email, fullName },
    input.source,
    input.targetTitle,
  );
  if (existing) {
    // A previously declined candidate re-applying: reopen them into the review
    // queue with a note so the recruiter sees the repeat interest. Pending /
    // accepted matches are left untouched (already in the pipeline).
    if (existing.reviewStatus === "declined") {
      const reapplyNote = `\ud83d\udd01 Re-applied ${input.applicationDate}${
        input.targetTitle ? ` for ${input.targetTitle}` : ""
      }.`;
      const { data: prev } = await admin
        .from("person_recruiting")
        .select("notes")
        .eq("person_id", existing.personId)
        .maybeSingle();
      const prevNotes = (prev as { notes?: string | null } | null)?.notes ?? null;
      const application = applicationHasData(input.application) ? input.application : undefined;
      // Re-applying for an open job links them to it (the old job is kept in History).
      const job = await matchApplicationJob(admin, input);
      await admin
        .from("person_recruiting")
        .update({
          review_status: "pending",
          reviewed_at: null,
          reviewed_by: null,
          application_date: input.applicationDate,
          notes: [prevNotes, reapplyNote].filter(Boolean).join("\n\n"),
          ...(application ? { application } : {}),
          ...(job ? jobRecruitingFields(job) : {}),
        })
        .eq("person_id", existing.personId);
      if (job) await logAutoAssigned(existing.personId, job);
      for (const resume of resumes) {
        await storeResume(admin, existing.personId, resume);
      }
      return { status: "reapplied", personId: existing.personId };
    }
    // Still in the pipeline: no new profile, but keep any new documents (e.g.
    // a follow-up email with the cover letter) on the existing candidate.
    // An Indeed notice followed by the full website form lands here too, so
    // the richer application is kept.
    if (applicationHasData(input.application)) {
      await admin
        .from("person_recruiting")
        .update({ application: input.application })
        .eq("person_id", existing.personId);
    }
    for (const resume of resumes) {
      await storeResume(admin, existing.personId, resume);
    }
    return { status: "duplicate" };
  }

  const { data: person, error: pErr } = await admin
    .from("person")
    .insert({
      status: "applicant",
      first_name: first,
      last_name: last,
      full_name: fullName,
      email: input.email,
      phone_mobile: formatPhoneNumber(input.phone),
      postal_code: input.postalCode ?? null,
    })
    .select("id")
    .single();

  if (pErr || !person) {
    return { status: "error", error: pErr?.message ?? "Could not create candidate." };
  }

  const personId = (person as { id: string }).id;

  // Auto-ingested applicants start in the review queue (pending); a recruiter
  // accepts or rejects them from the ATS Review tab.
  const job = await matchApplicationJob(admin, input);
  const { error: rErr } = await admin.from("person_recruiting").upsert(
    {
      person_id: personId,
      source: input.source,
      target_title: input.targetTitle,
      job_location: input.jobLocation ?? null,
      application_date: input.applicationDate,
      notes: input.notes,
      review_status: "pending",
      candidate_location: input.candidateLocation ?? null,
      source_detail: input.sourceDetail ?? null,
      education: input.education ?? null,
      relevant_experience: input.relevantExperience ?? null,
      ...(applicationHasData(input.application) ? { application: input.application } : {}),
      ...(job ? jobRecruitingFields(job) : {}),
    },
    { onConflict: "person_id" },
  );
  if (rErr) {
    // Roll back the just-created person so we never leave a recruiting-less
    // shell record (which would be invisible in the ATS and un-triageable).
    await admin.from("person").delete().eq("id", personId);
    return { status: "error", error: `Recruiting details failed to save: ${rErr.message}` };
  }

  if (job) await logAutoAssigned(personId, job);

  for (const resume of resumes) {
    await storeResume(admin, personId, resume);
  }

  return { status: "created", personId };
}
