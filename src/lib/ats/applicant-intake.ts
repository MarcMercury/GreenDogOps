import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

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
  /** ISO date (yyyy-mm-dd) the application was received. */
  applicationDate: string;
  notes: string | null;
}

export interface ApplicantResume {
  fileName: string;
  contentType: string;
  buffer: Buffer;
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

/** Store a resume on the candidate's document shelf (best-effort, non-fatal). */
async function storeResume(admin: Admin, personId: string, resume: ApplicantResume): Promise<void> {
  if (resume.buffer.length === 0) return;
  const safeName = (resume.fileName || "resume").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const contentType = resume.contentType || "application/octet-stream";
  const storagePath = `${personId}/${Date.now()}_${safeName}`;

  const { error: upErr } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, resume.buffer, { contentType, upsert: false });
  if (upErr) return;

  const { error: dbErr } = await admin.from("person_document").insert({
    person_id: personId,
    title: safeName,
    category: "Resume",
    storage_path: storagePath,
    file_name: safeName,
    mime_type: contentType,
    size_bytes: resume.buffer.length,
    source: "Inbound application",
  });
  if (dbErr) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
  }
}

/**
 * Create a recruiting candidate (`person` status = applicant + a
 * `person_recruiting` row) and attach any resumes. De-duplicates against
 * recent applications from the same source. Requires at least an email or a
 * name (Indeed email notifications have a name but no email).
 */
export async function createApplicantProfile(
  input: ApplicantInput,
  resumes: ApplicantResume[] = [],
): Promise<IntakeOutcome> {
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
      await admin
        .from("person_recruiting")
        .update({
          review_status: "pending",
          reviewed_at: null,
          reviewed_by: null,
          application_date: input.applicationDate,
          notes: [prevNotes, reapplyNote].filter(Boolean).join("\n\n"),
        })
        .eq("person_id", existing.personId);
      for (const resume of resumes) {
        await storeResume(admin, existing.personId, resume);
      }
      return { status: "reapplied", personId: existing.personId };
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
      phone_mobile: input.phone,
    })
    .select("id")
    .single();

  if (pErr || !person) {
    return { status: "error", error: pErr?.message ?? "Could not create candidate." };
  }

  const personId = (person as { id: string }).id;

  // Auto-ingested applicants start in the review queue (pending); a recruiter
  // accepts or rejects them from the ATS Review tab.
  await admin.from("person_recruiting").upsert(
    {
      person_id: personId,
      source: input.source,
      target_title: input.targetTitle,
      application_date: input.applicationDate,
      notes: input.notes,
      review_status: "pending",
    },
    { onConflict: "person_id" },
  );

  for (const resume of resumes) {
    await storeResume(admin, personId, resume);
  }

  return { status: "created", personId };
}
