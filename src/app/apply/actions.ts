"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  createApplicantProfile,
  storeResume,
  todayISO,
  type ApplicantResume,
} from "@/lib/ats/applicant-intake";
import { guessDocumentCategory } from "@/lib/ats/document-category";
import {
  fileProblem,
  isEmail,
  parseFields,
  readSubmission,
  validateAnswers,
  type AnswerValue,
  type RecruitingFormField,
} from "@/lib/ats/forms";
import { normalizeSource } from "@/lib/ats/normalize";
import { positionLabel } from "@/lib/ats/types";
import { formatPhoneNumber } from "@/lib/shared/phone";
import { normalizeUsZip } from "@/lib/shared/zip";
import { cityOrZipLookup } from "@/lib/shared/zip-lookup";

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function str(v: FormDataEntryValue | null, max = 500): string | null {
  if (v == null || typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s === "" ? null : s;
}

async function toUpload(file: File, category?: string): Promise<ApplicantResume> {
  return {
    fileName: file.name || "upload",
    contentType: file.type || "application/octet-stream",
    buffer: Buffer.from(await file.arrayBuffer()),
    category: category ?? guessDocumentCategory(file.name, "other"),
  };
}

/** The application's built-in questions, as stored with each response. */
const CORE_RESPONSE_FIELDS: RecruitingFormField[] = [
  { id: "first_name", type: "short_text", label: "First name", description: null, required: true, options: [] },
  { id: "last_name", type: "short_text", label: "Last name", description: null, required: true, options: [] },
  { id: "email", type: "short_text", label: "Email", description: null, required: true, options: [] },
  { id: "phone", type: "short_text", label: "Phone", description: null, required: true, options: [] },
  { id: "job", type: "short_text", label: "Position applying for", description: null, required: true, options: [] },
  { id: "location", type: "short_text", label: "City or ZIP code", description: null, required: true, options: [] },
  { id: "resume", type: "file", label: "Resume", description: null, required: false, options: [] },
  { id: "cover_letter", type: "long_text", label: "Cover letter / notes", description: null, required: false, options: [] },
];

/**
 * The public Standard Application. Creates (or updates) the candidate, links
 * the job they picked, attaches their resume and files, records the answers
 * and drops them in the Review Queue — the same intake path as the website
 * careers form and Indeed.
 */
export async function submitApplication(formId: string, fd: FormData): Promise<SubmitResult> {
  // Bots fill every field; people never see this one.
  if (str(fd.get("website"))) return { ok: true };

  const admin = createAdminClient();
  const { data: formData } = await admin
    .from("recruiting_form")
    .select("id, name, kind, fields, active, require_resume")
    .eq("id", formId)
    .maybeSingle();
  const form = formData as {
    id: string;
    name: string;
    kind: string;
    fields: unknown;
    active: boolean;
    require_resume: boolean;
  } | null;
  if (!form || form.kind !== "application" || !form.active) {
    return { ok: false, error: "This application is no longer accepting submissions." };
  }
  const fields = parseFields(form.fields);

  const fieldErrors: Record<string, string> = {};
  const firstName = str(fd.get("first_name"), 100);
  const lastName = str(fd.get("last_name"), 100);
  const email = str(fd.get("email"), 200)?.toLowerCase() ?? null;
  const phone = formatPhoneNumber(str(fd.get("phone"), 40));
  const location = str(fd.get("location"), 120);
  const coverLetter = str(fd.get("cover_letter"), 20000);
  const jobId = str(fd.get("job"), 60);
  const jobOther = str(fd.get("job_other"), 120);
  const resume = fd.get("resume");
  const resumeFile = resume && typeof resume === "object" && resume.size > 0 ? (resume as File) : null;

  if (!firstName) fieldErrors.first_name = "Enter your first name.";
  if (!lastName) fieldErrors.last_name = "Enter your last name.";
  if (!isEmail(email)) fieldErrors.email = "Enter a valid email.";
  if (!phone) fieldErrors.phone = "Enter your phone number.";
  if (!location) fieldErrors.location = "Enter your city or ZIP code.";
  if (!jobId && !jobOther) fieldErrors.job = "Choose the position you're applying for.";
  if (form.require_resume && !resumeFile) fieldErrors.resume = "Attach your resume.";
  if (resumeFile) {
    const p = fileProblem(resumeFile);
    if (p) fieldErrors.resume = p;
  }

  const { raw, files } = readSubmission(fields, fd);
  const checked = validateAnswers(fields, raw, new Set(files.keys()));
  Object.assign(fieldErrors, checked.errors);
  for (const [id, file] of files) {
    const p = fileProblem(file);
    if (p) fieldErrors[id] = p;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "Please fix the highlighted answers.", fieldErrors };
  }

  let job: { id: string; title: string; location: string | null } | null = null;
  if (jobId) {
    const { data } = await admin
      .from("position")
      .select("id, title, location, status")
      .eq("id", jobId)
      .maybeSingle();
    const row = data as { id: string; title: string; location: string | null; status: string } | null;
    if (!row || row.status !== "open") {
      return {
        ok: false,
        error: "That position just closed. Please choose another.",
        fieldErrors: { job: "No longer open." },
      };
    }
    job = row;
  }

  const zip = normalizeUsZip(location);
  const uploads: ApplicantResume[] = [];
  if (resumeFile) uploads.push(await toUpload(resumeFile, "resume"));

  const outcome = await createApplicantProfile(
    {
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(" "),
      email,
      phone,
      source: normalizeSource(str(fd.get("source"), 60)) || "GD Website",
      sourceDetail: `Ops application: ${form.name}`,
      targetTitle: job?.title ?? jobOther,
      jobLocation: job?.location ?? null,
      positionId: job?.id ?? null,
      applicationDate: todayISO(),
      notes: coverLetter,
      postalCode: zip,
      candidateLocation: zip ? await cityOrZipLookup(null, zip) : location,
    },
    uploads,
  );
  if (outcome.status === "error") {
    console.error("[apply] intake failed:", outcome.error);
    return { ok: false, error: "We couldn't submit your application. Please try again." };
  }
  const personId = outcome.personId;

  const answers: Record<string, AnswerValue> = {
    ...checked.answers,
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    job: job ? positionLabel(job) : jobOther,
    location,
    cover_letter: coverLetter,
  };
  if (resumeFile) {
    const { data: doc } = await admin
      .from("person_document")
      .select("id")
      .eq("person_id", personId)
      .eq("file_name", resumeFile.name || "upload")
      .eq("size_bytes", resumeFile.size)
      .limit(1)
      .maybeSingle();
    if (doc) answers.resume = { document_id: (doc as { id: string }).id, file_name: resumeFile.name };
  }
  for (const [id, file] of files) {
    const docId = await storeResume(admin, personId, await toUpload(file), `Application form: ${form.name}`);
    if (docId) answers[id] = { document_id: docId, file_name: file.name };
  }

  const { error: rErr } = await admin.from("recruiting_form_response").insert({
    form_id: form.id,
    person_id: personId,
    form_name: form.name,
    form_kind: "application",
    fields: [...CORE_RESPONSE_FIELDS, ...fields],
    answers,
  });
  if (rErr) console.error("[apply] response save failed:", rErr.message);

  return { ok: true };
}
