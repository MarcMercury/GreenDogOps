import "server-only";
import crypto from "node:crypto";
import {
  createApplicantProfile,
  splitName,
  type ApplicantResume,
} from "@/lib/ats/applicant-intake";

// ---------------------------------------------------------------------------
// Indeed Apply ingestion.
//
// Indeed delivers each application as an HTTP POST (JSON) to the `postUrl` we
// register in a job's `indeed-apply-data` metadata (XML feed or Job Sync API).
// The request is signed with `X-Indeed-Signature`: base64(HMAC-SHA1(rawBody))
// keyed by our Indeed Apply API secret. We verify that, then hand the mapped
// application to the shared applicant intake, which creates the profile and
// attaches the resume.
//
// Docs: https://docs.indeed.com/indeed-apply/application-data
//       https://docs.indeed.com/indeed-apply/message-signature-generation
//       https://docs.indeed.com/indeed-apply/application-delivery
// ---------------------------------------------------------------------------

/** Subset of the Indeed Apply POST body that we actually consume. */
export interface IndeedApplyPayload {
  id?: string;
  appliedOnMillis?: number;
  locale?: string;
  job?: {
    jobId?: string;
    jobKey?: string;
    jobTitle?: string;
    jobCompany?: string;
    jobLocation?: string;
    jobUrl?: string;
    jobMeta?: string;
  };
  applicant?: {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phoneNumber?: string;
    coverletter?: string;
    resume?: {
      file?: { fileName?: string; contentType?: string; data?: string };
      text?: string;
    };
  };
  // Modern + legacy screener question containers.
  screenerQuestionsAndAnswers?: { questionsAndAnswers?: unknown };
  questionsAndAnswers?: unknown;
}

export type IngestStatus = 200 | 400 | 409 | 422 | 500;

export interface IngestResult {
  status: IngestStatus;
  body: { ok: boolean; personId?: string; error?: string };
}

/**
 * Verify the `X-Indeed-Signature` header against the raw request body.
 * Indeed signs base64(HMAC-SHA1(rawBody)) with the shared API secret. Uses a
 * timing-safe comparison. Returns false when the secret is unset so callers
 * can fail closed with a 401.
 */
export function verifyIndeedSignature(rawBody: Buffer, signature: string | null): boolean {
  const secret = process.env.INDEED_APPLY_SECRET;
  if (!secret || !signature) return false;

  const expected = crypto.createHmac("sha1", secret).update(rawBody).digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Flatten Indeed's screener Q&A into a readable block for the notes field. */
function summarizeQuestions(payload: IndeedApplyPayload): string | null {
  const container =
    payload.screenerQuestionsAndAnswers?.questionsAndAnswers ??
    payload.questionsAndAnswers ??
    null;
  if (!Array.isArray(container)) return null;

  const lines: string[] = [];
  for (const entry of container) {
    if (!entry || typeof entry !== "object") continue;
    const q = (entry as { question?: unknown }).question;
    const a = (entry as { answer?: unknown }).answer;
    const questionText =
      typeof q === "string"
        ? q
        : q && typeof q === "object"
          ? String((q as { question?: unknown }).question ?? "")
          : "";
    let answerText = "";
    if (typeof a === "string") answerText = a;
    else if (Array.isArray(a))
      answerText = a
        .map((x) =>
          x && typeof x === "object" ? String((x as { label?: unknown }).label ?? "") : String(x),
        )
        .filter(Boolean)
        .join(", ");
    else if (a && typeof a === "object")
      answerText = String((a as { label?: unknown }).label ?? "");
    if (questionText) lines.push(`Q: ${questionText}\nA: ${answerText}`);
  }
  return lines.length ? lines.join("\n\n") : null;
}

/**
 * Turn a verified Indeed Apply payload into a recruiting candidate. Returns an
 * HTTP status matching Indeed's delivery contract (200 ok, 409 duplicate, 400
 * missing required data, 422 on failure) so the caller can respond directly.
 */
export async function ingestIndeedApplication(
  payload: IndeedApplyPayload,
): Promise<IngestResult> {
  const applicant = payload.applicant;
  const email = applicant?.email?.trim() || null;
  if (!email) {
    return { status: 400, body: { ok: false, error: "Missing applicant email." } };
  }

  const jobTitle = payload.job?.jobTitle?.trim() || null;
  let first = applicant?.firstName?.trim() || null;
  let last = applicant?.lastName?.trim() || null;
  if (!first && !last && applicant?.fullName) {
    const split = splitName(applicant.fullName);
    first = split.first;
    last = split.last;
  }

  const applicationDate = payload.appliedOnMillis
    ? new Date(payload.appliedOnMillis).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const coverLetter = applicant?.coverletter?.trim() || null;
  const screener = summarizeQuestions(payload);
  const notes =
    [coverLetter && `Cover letter:\n${coverLetter}`, screener && `Screener:\n${screener}`]
      .filter(Boolean)
      .join("\n\n") || null;

  const resumes: ApplicantResume[] = [];
  const file = applicant?.resume?.file;
  if (file?.data) {
    resumes.push({
      fileName: file.fileName || "resume",
      contentType: file.contentType || "application/octet-stream",
      buffer: Buffer.from(file.data, "base64"),
    });
  }

  const outcome = await createApplicantProfile(
    {
      firstName: first,
      lastName: last,
      fullName: applicant?.fullName?.trim() || null,
      email,
      phone: applicant?.phoneNumber?.trim() || null,
      source: "Indeed",
      targetTitle: jobTitle,
      applicationDate,
      notes,
    },
    resumes,
  );

  if (outcome.status === "duplicate") {
    return { status: 409, body: { ok: false, error: "Duplicate application." } };
  }
  if (outcome.status === "error") {
    return { status: 422, body: { ok: false, error: outcome.error } };
  }
  return { status: 200, body: { ok: true, personId: outcome.personId } };
}