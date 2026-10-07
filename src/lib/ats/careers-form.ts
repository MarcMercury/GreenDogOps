// ---------------------------------------------------------------------------
// Website careers form (GeniusVets / gv-clients.com) email parsing.
//
// The form emails greendogcareers@gmail.com a plain-text body of `*Label*`
// lines, each followed by its value. Two formats have been seen:
//   - "Career Application NNNN": separate First Name / Last Name, resume
//     attached to the email.
//   - "Webform submission from: Apply for a position" (since late Aug 2026):
//     a single Name field, Practice/Location, and the resume uploaded to the
//     website — the email only carries a numbered link footnote to it.
//
// Kept free of server-only imports so it can be unit-tested.
// ---------------------------------------------------------------------------

import { guessDocumentCategory } from "./document-category";
import { applicationFromLabels, matchKey, type ApplicationDetails } from "./application";

export interface CareersFormUpload {
  fileName: string;
  url: string;
  /** DOCUMENT_CATEGORY_LABELS key, from the form field and file name. */
  category: string;
}

export interface CareersFormFields {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  location: string | null;
  coverLetter: string | null;
  /** Resume typed into a text box instead of uploaded. */
  pastedResume: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /**
   * Every file the applicant uploaded (resume, cover letter, …), referenced by
   * numbered link footnotes rather than attached to the email.
   */
  uploads: CareersFormUpload[];
  /** Everything else on the form (availability, eligibility, experience, …). */
  application: ApplicationDetails;
}

// Labels read into the top-level fields above, so they aren't repeated as
// unmatched `extra` answers on the application.
const TOP_LEVEL_LABELS = new Set(
  [
    "first name",
    "last name",
    "name",
    "full name",
    "email",
    "email address",
    "phone number",
    "phone",
    "role applying for",
    "position",
    "role",
    "practice/location",
    "location",
    "cover letter",
    "paste resume",
    "resume text",
    "city",
    "state",
    "zip code",
    "zip",
    "postal code",
  ].map(matchKey),
);

const LABEL_LINE = /^\*([^*\n]+)\*[ \t]*\r?$/gm;
const FOOTNOTE_LINE = /^\[(\d+)\]\s+(\S+)/gm;
const REF = /\s*\[\d+\]/g;
// "Jane Doe Resume .pdf [3]" — a file name followed by its link footnote.
const FILE_REF =
  /^(.+?\.(?:pdf|docx?|rtf|txt|odt|pages|png|jpe?g|gif|webp|heic))\s*\[(\d+)\]/i;
const ANY_REF = /^(.+?)\s*\[(\d+)\]/;

function isUploadField(key: string): boolean {
  return key.startsWith("upload") || key.startsWith("attach") || key === "resume" || key === "cv";
}

/** Lower-cased label without trailing colon / parenthetical hint. */
function labelKey(label: string): string {
  return label
    .replace(/\(.*?\)/g, "")
    .replace(/:\s*$/, "")
    .trim()
    .toLowerCase();
}

/** Split the body into label → raw value (text up to the next label). */
function splitFields(body: string): Map<string, string> {
  // The numbered link list sits at the very end; keep it out of the last field.
  const footnoteStart = body.search(/\n\[1\]\s+\S/);
  const text = footnoteStart >= 0 ? body.slice(0, footnoteStart) : body;

  const labels = [...text.matchAll(LABEL_LINE)];
  const fields = new Map<string, string>();
  labels.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < labels.length ? labels[i + 1].index : text.length;
    const key = labelKey(m[1]);
    if (!fields.has(key)) fields.set(key, text.slice(start, end).trim());
  });
  return fields;
}

function footnotes(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(FOOTNOTE_LINE)) out.set(m[1], m[2]);
  return out;
}

function clean(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.replace(REF, "").replace(/\r/g, "").trim();
  return s || null;
}

/** True when the email body looks like a careers form submission. */
export function isCareersFormBody(body: string): boolean {
  const f = splitFields(body);
  return f.has("email") && (f.has("name") || f.has("first name") || f.has("last name"));
}

export function parseCareersForm(body: string): CareersFormFields | null {
  const fields = splitFields(body);
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = clean(fields.get(k));
      if (v) return v;
    }
    return null;
  };

  const firstName = get("first name");
  const lastName = get("last name");
  const fullName = get("name", "full name");
  const email = get("email", "email address");
  if (!firstName && !lastName && !fullName && !email) return null;

  // Any field whose value is a linked file counts as an upload, so a separate
  // "Upload Cover Letter" field is picked up alongside the resume.
  const links = footnotes(body);
  const uploads: CareersFormUpload[] = [];
  const fileFields = new Set<string>();
  let coverLetterIsFile = false;
  for (const [key, raw] of fields) {
    if (isUploadField(key)) fileFields.add(key);
    const ref = raw.match(FILE_REF) ?? (isUploadField(key) ? raw.match(ANY_REF) : null);
    if (!ref) continue;
    fileFields.add(key);
    const url = links.get(ref[2]);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const fileName = ref[1].trim();
    const isCover = key.includes("cover");
    if (key === "cover letter") coverLetterIsFile = true;
    uploads.push({
      fileName,
      url,
      category: isCover ? "cover_letter" : guessDocumentCategory(fileName, "resume"),
    });
  }

  // Everything that isn't identity or a file goes onto the application.
  const answerFields = new Map<string, string>();
  for (const [key, raw] of fields) {
    if (fileFields.has(key)) continue;
    const v = clean(raw);
    if (v) answerFields.set(key, v);
  }
  const { application, consumed } = applicationFromLabels(answerFields);
  const extra: Array<{ label: string; value: string }> = [];
  for (const [key, value] of answerFields) {
    const k = matchKey(key);
    if (consumed.has(k) || TOP_LEVEL_LABELS.has(k)) continue;
    extra.push({ label: originalLabel(body, key), value });
  }
  if (extra.length) application.extra = extra;

  return {
    firstName,
    lastName,
    fullName,
    email: email?.replace(/^mailto:/i, "") ?? null,
    phone: get("phone number", "phone"),
    role: get("role applying for", "position", "role"),
    location: get("practice/location", "location"),
    coverLetter: coverLetterIsFile ? null : get("cover letter"),
    pastedResume: get("paste resume", "resume text"),
    city: get("city"),
    state: get("state"),
    zip: get("zip code", "zip", "postal code"),
    uploads,
    application,
  };
}

/** The label as the form wrote it (keys are lower-cased for lookup). */
function originalLabel(body: string, key: string): string {
  for (const m of body.matchAll(LABEL_LINE)) {
    if (labelKey(m[1]) === key) return m[1].replace(/:\s*$/, "").trim();
  }
  return key;
}

// Hosts the resume link may pass through: the form's click-tracking domain and
// the website that stores the upload.
const RESUME_HOSTS = [/(^|\.)gv-clients\.com$/i, /(^|\.)greendogdental\.com$/i];

export function isAllowedResumeHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return RESUME_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}
