import "server-only";
import { google, type gmail_v1 } from "googleapis";
import { extractResumeCandidate } from "@/lib/ats/import";
import {
  createApplicantProfile,
  todayISO,
  type ApplicantInput,
  type ApplicantResume,
} from "@/lib/ats/applicant-intake";
import type { ParsedCandidate } from "@/lib/ats/import-types";

// ---------------------------------------------------------------------------
// Gmail applicant intake (greendogcareers@gmail.com).
//
// Polls the careers inbox for new mail — Indeed application notifications and
// direct resume submissions from the website — extracts the candidate with the
// same AI parser the manual ATS import uses, and creates a profile via the
// shared intake. Processed messages get a "GD-Imported" label so they are
// never re-imported (idempotent across cron runs).
//
// Auth: OAuth2 with a long-lived refresh token. A consumer @gmail.com inbox
// cannot be read by a service account, so we use a one-time user consent.
// Required env: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.
// Optional env: GMAIL_INGEST_QUERY (Gmail search), GMAIL_INGEST_MAX (batch).
// ---------------------------------------------------------------------------

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const IMPORTED_LABEL = "GD-Imported";
// Only real applications: Indeed per-candidate "New application" notifications
// (conversation-*@indeedemail.com) and direct website submissions from the
// careers form (gv-clients.com). Everything else in the inbox is ignored.
// Gmail requires the label/date filters INSIDE each OR group — a leading
// filter before `(A OR B)` silently matches nothing.
const DEFAULT_QUERY =
  '(from:indeedemail.com subject:"New application" newer_than:120d -label:GD-Imported)' +
  ' OR (from:gv-clients.com "Career Application" newer_than:120d -label:GD-Imported)';
const DEFAULT_MAX = 25;
// Attachment extensions we treat as a resume worth parsing / storing.
const RESUME_EXT = /\.(pdf|docx?|rtf|txt|png|jpe?g|webp)$/i;

export interface GmailIngestResult {
  ok: boolean;
  scanned: number;
  created: number;
  reapplied: number;
  duplicates: number;
  skipped: number;
  errors: string[];
}

/** Build a Gmail client authenticated with the stored OAuth2 refresh token. */
function getGmailClient(): gmail_v1.Gmail {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Gmail intake is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, " +
        "and GMAIL_REFRESH_TOKEN in .env.local / Vercel.",
    );
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken, scope: GMAIL_SCOPE });
  return google.gmail({ version: "v1", auth });
}

/** Resolve (creating if needed) the label id we stamp on processed mail. */
async function getImportedLabelId(gmail: gmail_v1.Gmail): Promise<string> {
  const { data } = await gmail.users.labels.list({ userId: "me" });
  const existing = data.labels?.find((l) => l.name === IMPORTED_LABEL);
  if (existing?.id) return existing.id;
  const { data: created } = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: IMPORTED_LABEL,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  if (!created.id) throw new Error("Could not create the GD-Imported label.");
  return created.id;
}

/** Pull a single header value (case-insensitive) from a message payload. */
function header(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string {
  const h = payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/** Decode Gmail's base64url body data to a UTF-8 string. */
function decodeText(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64").toString("utf-8");
}

/** Strip HTML tags to plain text as a fallback when no text/plain part exists. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

interface ExtractedMessage {
  bodyText: string;
  attachments: { partId: string; filename: string; mimeType: string; attachmentId: string }[];
}

/** Walk the MIME tree collecting the best body text + resume attachments. */
function walkParts(payload: gmail_v1.Schema$MessagePart | undefined): ExtractedMessage {
  let plain = "";
  let html = "";
  const attachments: ExtractedMessage["attachments"] = [];

  const visit = (part?: gmail_v1.Schema$MessagePart) => {
    if (!part) return;
    const mime = part.mimeType ?? "";
    const filename = part.filename ?? "";
    const attachmentId = part.body?.attachmentId ?? "";
    if (filename && attachmentId) {
      attachments.push({ partId: part.partId ?? "", filename, mimeType: mime, attachmentId });
    } else if (mime === "text/plain") {
      plain += decodeText(part.body?.data);
    } else if (mime === "text/html") {
      html += decodeText(part.body?.data);
    }
    part.parts?.forEach(visit);
  };
  visit(payload);

  const bodyText = plain.trim() || htmlToText(html);
  return { bodyText, attachments };
}

/** Fetch and decode one attachment's binary content. */
async function fetchAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const { data } = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });
  return Buffer.from(data.data ?? "", "base64");
}

/** Extract the display name from a "Name <addr>" header, ignoring bare addresses. */
function displayName(from: string): string | null {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  const n = m ? m[1].trim() : null;
  return n && !n.includes("@") ? n : null;
}

/** Pull a single `*Label*` field value from the gv-clients form body. */
function gvField(body: string, label: string): string | null {
  const m = body.match(new RegExp("\\*\\s*" + label + "\\s*\\*\\s*([^*\\[]+)", "i"));
  const v = m ? m[1].trim() : null;
  return v || null;
}

/** Build an applicant from an Indeed "New application" notification (name + role only). */
function parseIndeedApplication(
  from: string,
  subject: string,
  bodyText: string,
): ApplicantInput | null {
  const name = displayName(from) || bodyText.match(/^(.+?)\s+applied to/i)?.[1]?.trim() || null;
  if (!name) return null;
  let role = subject.match(/New application for\s+(.+)/i)?.[1] ?? null;
  if (role) role = role.split(",")[0].trim(); // drop ", City, State"
  return {
    firstName: null,
    lastName: null,
    fullName: name,
    email: null,
    phone: null,
    source: "Indeed",
    targetTitle: role,
    applicationDate: todayISO(),
    notes: subject,
  };
}

/** Build an applicant from a gv-clients "Career Application" form email. */
function parseGvClientsApplication(bodyText: string): ApplicantInput | null {
  const first = gvField(bodyText, "First Name");
  const last = gvField(bodyText, "Last Name");
  const email = gvField(bodyText, "Email");
  if (!first && !last && !email) return null;
  const cover = bodyText.match(/\*\s*Cover Letter\s*\*\s*([\s\S]+)/i)?.[1]?.trim() ?? null;
  return {
    firstName: first,
    lastName: last,
    fullName: null,
    email,
    phone: gvField(bodyText, "Phone Number"),
    source: "GD Website",
    targetTitle: gvField(bodyText, "Role Applying For"),
    applicationDate: todayISO(),
    notes: cover,
  };
}

/** Convert one message into a recruiting profile. */
async function ingestOne(
  gmail: gmail_v1.Gmail,
  message: gmail_v1.Schema$Message,
): Promise<"created" | "reapplied" | "duplicate" | "skipped"> {
  const payload = message.payload;
  const subject = header(payload, "Subject");
  const from = header(payload, "From");
  const fromLc = from.toLowerCase();
  const { bodyText, attachments } = walkParts(payload);

  const applicationDate = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString().slice(0, 10)
    : todayISO();

  // Gather resume-like attachments (skip inline images / logos with no name).
  const resumeParts = attachments.filter((a) => RESUME_EXT.test(a.filename));
  const resumes: ApplicantResume[] = [];
  for (const part of resumeParts) {
    const buffer = await fetchAttachment(gmail, message.id!, part.attachmentId);
    if (buffer.length > 0) {
      resumes.push({ fileName: part.filename, contentType: part.mimeType, buffer });
    }
  }

  let input: ApplicantInput | null = null;

  if (fromLc.includes("indeedemail.com") && /new application/i.test(subject)) {
    // Indeed strips PII from notifications: we get name + role only.
    input = parseIndeedApplication(from, subject, bodyText);
  } else if (fromLc.includes("gv-clients.com")) {
    // Direct website submission with structured form fields.
    input = parseGvClientsApplication(bodyText);
  } else {
    // Fallback for anything else: AI-extract from a resume attachment or body.
    let candidate: ParsedCandidate | null = null;
    if (resumes.length > 0) {
      const r = await extractResumeCandidate(
        resumes[0].fileName,
        resumes[0].contentType,
        resumes[0].buffer,
      );
      if (r.ok) candidate = r.candidate;
    }
    if (!candidate && bodyText) {
      const r = await extractResumeCandidate(
        "application.txt",
        "text/plain",
        Buffer.from(bodyText, "utf-8"),
      );
      if (r.ok) candidate = r.candidate;
    }
    if (candidate) {
      input = {
        firstName: candidate.first_name,
        lastName: candidate.last_name,
        fullName: candidate.full_name,
        email: candidate.email,
        phone: candidate.phone_mobile,
        source: /indeed/i.test(fromLc) ? "Indeed" : "GD Website",
        targetTitle: candidate.target_title,
        applicationDate,
        notes:
          [candidate.notes, subject && `Received via email: ${subject}`]
            .filter(Boolean)
            .join("\n\n") || null,
      };
    }
  }

  if (!input || (!input.email && !input.fullName && !input.firstName && !input.lastName)) {
    return "skipped";
  }
  input.applicationDate = applicationDate;

  const outcome = await createApplicantProfile(input, resumes);
  if (outcome.status === "created") return "created";
  if (outcome.status === "reapplied") return "reapplied";
  if (outcome.status === "duplicate") return "duplicate";
  return "skipped";
}

/**
 * Poll the careers inbox and import every unprocessed application. Safe to run
 * on a schedule: each message is labeled `GD-Imported` and marked read once
 * handled, so subsequent runs skip it regardless of the outcome.
 */
export async function ingestGmailInbox(): Promise<GmailIngestResult> {
  const result: GmailIngestResult = {
    ok: true,
    scanned: 0,
    created: 0,
    reapplied: 0,
    duplicates: 0,
    skipped: 0,
    errors: [],
  };

  let gmail: gmail_v1.Gmail;
  let labelId: string;
  try {
    gmail = getGmailClient();
    labelId = await getImportedLabelId(gmail);
  } catch (err) {
    result.ok = false;
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }

  const query = process.env.GMAIL_INGEST_QUERY || DEFAULT_QUERY;
  const maxResults = Number(process.env.GMAIL_INGEST_MAX) || DEFAULT_MAX;

  const { data: list } = await gmail.users.messages.list({ userId: "me", q: query, maxResults });
  const ids = (list.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));

  for (const id of ids) {
    result.scanned++;
    try {
      const { data: message } = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });

      const outcome = await ingestOne(gmail, message);
      if (outcome === "created") result.created++;
      else if (outcome === "reapplied") result.reapplied++;
      else if (outcome === "duplicate") result.duplicates++;
      else result.skipped++;
    } catch (err) {
      result.skipped++;
      result.errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Stamp the message as processed regardless of outcome so it is never
    // re-scanned (prevents repeat AI calls and duplicate profiles).
    try {
      await gmail.users.messages.modify({
        userId: "me",
        id,
        requestBody: { addLabelIds: [labelId], removeLabelIds: ["UNREAD"] },
      });
    } catch (err) {
      result.errors.push(`label ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
