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

export interface CareersFormFields {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  location: string | null;
  coverLetter: string | null;
  /** Uploaded resume referenced by link (new format only). */
  resume: { fileName: string; url: string } | null;
}

const LABEL_LINE = /^\*([^*\n]+)\*[ \t]*\r?$/gm;
const FOOTNOTE_LINE = /^\[(\d+)\]\s+(\S+)/gm;
const REF = /\s*\[\d+\]/g;

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

  let resume: CareersFormFields["resume"] = null;
  const uploadKey = [...fields.keys()].find((k) => k.startsWith("upload") || k === "resume");
  const upload = uploadKey ? fields.get(uploadKey) : undefined;
  const ref = upload?.match(/^(.+?)\s*\[(\d+)\]/);
  if (ref) {
    const url = footnotes(body).get(ref[2]);
    if (url && /^https?:\/\//i.test(url)) resume = { fileName: ref[1].trim(), url };
  }

  return {
    firstName,
    lastName,
    fullName,
    email: email?.replace(/^mailto:/i, "") ?? null,
    phone: get("phone number", "phone"),
    role: get("role applying for", "position"),
    location: get("practice/location", "location"),
    coverLetter: get("cover letter"),
    resume,
  };
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
