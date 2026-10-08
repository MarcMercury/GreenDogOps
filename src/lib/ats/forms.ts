// ---------------------------------------------------------------------------
// Recruiting forms — the ATS "Forms" tab. Three kinds:
//   application  the public Standard Application (/apply). Core contact
//                fields are built in (see APPLICATION_CORE_FIELDS); the
//                questions here are the "standard application questions".
//   screening    a role-specific questionnaire sent to one candidate through a
//                unique link (/forms/<token>).
//   interview    an interview guide the interviewer fills in on the
//                candidate's Interview Tracking tab. Never shown to candidates.
//
// Pure, dependency-free: shared by the builder, the public renderer and the
// server actions that validate submissions.
// ---------------------------------------------------------------------------

import type { InterviewResponse } from "./types";

export type FormKind = "application" | "screening" | "interview";

export type FormFieldType =
  | "short_text"
  | "long_text"
  | "multiple_choice"
  | "checkboxes"
  | "dropdown"
  | "yes_no"
  | "number"
  | "date"
  | "file"
  | "section";

export interface RecruitingFormField {
  /** Stable key for the answers jsonb; never changes once created. */
  id: string;
  type: FormFieldType;
  label: string;
  description: string | null;
  required: boolean;
  /** Choice questions only. */
  options: string[];
}

export interface RecruitingForm {
  id: string;
  kind: FormKind;
  name: string;
  description: string | null;
  intro: string | null;
  success_message: string | null;
  fields: RecruitingFormField[];
  job_titles: string[];
  /** Interview guides only: the interview types it loads for (empty = any). */
  interview_types: string[];
  slug: string | null;
  is_default: boolean;
  require_resume: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FormRequest {
  id: string;
  token: string;
  form_id: string;
  person_id: string;
  status: "sent" | "completed" | "cancelled";
  sent_to: string | null;
  sent_at: string;
  sent_by_name: string | null;
  completed_at: string | null;
}

/** A file answer: the uploaded document on the candidate's Documents tab. */
export interface FileAnswer {
  document_id: string;
  file_name: string;
}

export type AnswerValue = string | string[] | FileAnswer | null;

export interface FormResponse {
  id: string;
  form_id: string | null;
  request_id: string | null;
  person_id: string;
  form_name: string;
  form_kind: FormKind;
  fields: RecruitingFormField[];
  answers: Record<string, AnswerValue>;
  submitted_at: string;
}

export const FORM_KIND_LABELS: Record<FormKind, string> = {
  application: "Standard Application",
  screening: "Role-specific form",
  interview: "Interview guide",
};

export function isFormKind(v: unknown): v is FormKind {
  return v === "application" || v === "screening" || v === "interview";
}

/** Question types an interviewer can fill in (no candidate file uploads). */
export function fieldTypeAllowed(kind: FormKind, t: FormFieldType): boolean {
  return kind !== "interview" || t !== "file";
}

export const FORM_FIELD_TYPES: { value: FormFieldType; label: string; icon: string }[] = [
  { value: "short_text", label: "Short answer", icon: "—" },
  { value: "long_text", label: "Paragraph", icon: "¶" },
  { value: "multiple_choice", label: "Multiple choice", icon: "◉" },
  { value: "checkboxes", label: "Checkboxes", icon: "☑" },
  { value: "dropdown", label: "Dropdown", icon: "▾" },
  { value: "yes_no", label: "Yes / No", icon: "✓✗" },
  { value: "number", label: "Number", icon: "#" },
  { value: "date", label: "Date", icon: "📅" },
  { value: "file", label: "File upload", icon: "📎" },
  { value: "section", label: "Section heading", icon: "§" },
];

export const FORM_FIELD_TYPE_LABELS = Object.fromEntries(
  FORM_FIELD_TYPES.map((t) => [t.value, t.label]),
) as Record<FormFieldType, string>;

const CHOICE_TYPES: FormFieldType[] = ["multiple_choice", "checkboxes", "dropdown"];

export function fieldHasOptions(t: FormFieldType): boolean {
  return CHOICE_TYPES.includes(t);
}

export function fieldIsAnswerable(t: FormFieldType): boolean {
  return t !== "section";
}

export const YES_NO_OPTIONS = ["Yes", "No"] as const;

/** Max size of one uploaded file, matching the documents shelf. */
export const MAX_FORM_FILE_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_FILE_TYPES =
  ".pdf,.doc,.docx,.rtf,.txt,.odt,.pages,.png,.jpg,.jpeg,.heic,application/pdf,image/*";

/**
 * The Standard Application's built-in fields. They feed the candidate profile
 * directly, so they're fixed — the builder only edits the questions after them.
 */
export const APPLICATION_CORE_FIELDS = [
  { id: "first_name", label: "First name" },
  { id: "last_name", label: "Last name" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "job", label: "Position applying for" },
  { id: "location", label: "Your city or ZIP code" },
  { id: "resume", label: "Resume" },
  { id: "cover_letter", label: "Cover letter / notes" },
] as const;

export const CORE_FIELD_IDS = new Set<string>(APPLICATION_CORE_FIELDS.map((f) => f.id));

/** A short random id for new questions ("q_k3j9x2"). */
export function newFieldId(existing: Iterable<string> = []): string {
  const taken = new Set(existing);
  for (;;) {
    const id = `q_${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.has(id) && !CORE_FIELD_IDS.has(id)) return id;
  }
}

export function newField(
  type: FormFieldType = "short_text",
  existing: Iterable<string> = [],
): RecruitingFormField {
  return {
    id: newFieldId(existing),
    type,
    label: "",
    description: null,
    required: false,
    options: fieldHasOptions(type) ? ["Option 1"] : [],
  };
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s === "" ? null : s;
}

/**
 * Parse stored / submitted questions into well-formed fields, dropping
 * anything malformed. Used on every read so a bad row never breaks a page.
 */
export function parseFields(
  raw: unknown,
  opts: { allowCore?: boolean } = {},
): RecruitingFormField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RecruitingFormField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const type = FORM_FIELD_TYPES.some((t) => t.value === r.type)
      ? (r.type as FormFieldType)
      : null;
    const id = typeof r.id === "string" && /^[a-z0-9_]{1,40}$/i.test(r.id) ? r.id : null;
    if (!type || !id || seen.has(id) || (!opts.allowCore && CORE_FIELD_IDS.has(id))) continue;
    seen.add(id);
    const options = fieldHasOptions(type)
      ? [
          ...new Set(
            (Array.isArray(r.options) ? r.options : [])
              .map((o) => cleanText(o, 200))
              .filter((o): o is string => o !== null),
          ),
        ].slice(0, 50)
      : [];
    out.push({
      id,
      type,
      label: cleanText(r.label, 500) ?? "",
      description: typeof r.description === "string" && r.description.trim()
        ? r.description.trim().slice(0, 1000)
        : null,
      required: fieldIsAnswerable(type) && r.required === true,
      options,
    });
  }
  return out;
}

/** Problems that stop a form from being saved. */
export function formFieldProblems(fields: RecruitingFormField[]): string[] {
  const problems: string[] = [];
  fields.forEach((f, i) => {
    const n = `Question ${i + 1}`;
    if (!f.label) problems.push(`${n} needs a title.`);
    if (fieldHasOptions(f.type) && f.options.length < 1) {
      problems.push(`${n} (“${f.label || "untitled"}”) needs at least one option.`);
    }
  });
  return problems;
}

/** "csr-screening" from "CSR Screening!" */
export function slugify(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Submitted values for one form, keyed by question id (files handled apart). */
export type RawAnswers = Record<string, string | string[] | undefined>;

export interface ValidatedAnswers {
  answers: Record<string, string | string[] | null>;
  errors: Record<string, string>;
}

/**
 * Check submitted answers against the questions: required answers present,
 * choices drawn from the options, numbers and dates well-formed. File
 * questions are validated by the caller (it holds the File objects); pass the
 * ids of file questions that received a file in `filesPresent`.
 */
export function validateAnswers(
  fields: RecruitingFormField[],
  raw: RawAnswers,
  filesPresent: ReadonlySet<string> = new Set(),
): ValidatedAnswers {
  const answers: Record<string, string | string[] | null> = {};
  const errors: Record<string, string> = {};
  const one = (v: string | string[] | undefined): string | null => {
    const s = (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
    return s === "" ? null : s.slice(0, 10000);
  };

  for (const f of fields) {
    if (!fieldIsAnswerable(f.type)) continue;
    if (f.type === "file") {
      if (f.required && !filesPresent.has(f.id)) errors[f.id] = "Please attach a file.";
      continue;
    }
    if (f.type === "checkboxes") {
      const vals = (Array.isArray(raw[f.id]) ? raw[f.id] : raw[f.id] ? [raw[f.id]] : []) as string[];
      const picked = [...new Set(vals.map((v) => v.trim()).filter(Boolean))];
      if (picked.some((v) => !f.options.includes(v))) {
        errors[f.id] = "Choose from the listed options.";
        continue;
      }
      if (f.required && picked.length === 0) errors[f.id] = "Choose at least one.";
      answers[f.id] = picked.length ? picked : null;
      continue;
    }
    const v = one(raw[f.id]);
    if (v === null) {
      if (f.required) errors[f.id] = "This question is required.";
      answers[f.id] = null;
      continue;
    }
    if ((f.type === "multiple_choice" || f.type === "dropdown") && !f.options.includes(v)) {
      errors[f.id] = "Choose from the listed options.";
      continue;
    }
    if (f.type === "yes_no" && !(YES_NO_OPTIONS as readonly string[]).includes(v)) {
      errors[f.id] = "Choose Yes or No.";
      continue;
    }
    if (f.type === "number" && !Number.isFinite(Number(v))) {
      errors[f.id] = "Enter a number.";
      continue;
    }
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      errors[f.id] = "Enter a date.";
      continue;
    }
    answers[f.id] = f.type === "short_text" ? v.slice(0, 1000) : v;
  }
  return { answers, errors };
}

export function isFileAnswer(v: AnswerValue | undefined): v is FileAnswer {
  return !!v && typeof v === "object" && !Array.isArray(v) && "document_id" in v;
}

/** An answer as plain text, for summaries and Slack. */
export function answerText(v: AnswerValue | undefined): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length ? v.join(", ") : null;
  if (isFileAnswer(v)) return `📎 ${v.file_name}`;
  return v;
}

/** Forms worth suggesting first for a candidate's role. */
export function formMatchesTitle(
  form: Pick<RecruitingForm, "job_titles">,
  title: string | null | undefined,
): boolean {
  if (!title) return false;
  const t = title.trim().toLowerCase();
  return form.job_titles.some((j) => j.trim().toLowerCase() === t);
}

export type InterviewGuideOption = Pick<
  RecruitingForm,
  "id" | "name" | "intro" | "fields" | "job_titles" | "interview_types"
>;

/**
 * The guide to load for an interview: it must cover the interview type (or
 * any type) and the candidate's job title (or any job). The most specific
 * match wins — a title match outranks a type match — then the name.
 */
export function pickInterviewGuide<G extends Pick<RecruitingForm, "name" | "job_titles" | "interview_types">>(
  guides: G[],
  interviewType: string | null | undefined,
  jobTitle: string | null | undefined,
): G | null {
  let best: { guide: G; score: number } | null = null;
  for (const g of guides) {
    const typeOk = g.interview_types.length === 0 || (!!interviewType && g.interview_types.includes(interviewType));
    const titleOk = g.job_titles.length === 0 || formMatchesTitle(g, jobTitle);
    if (!typeOk || !titleOk) continue;
    const score = (g.job_titles.length ? 2 : 0) + (g.interview_types.length ? 1 : 0);
    if (!best || score > best.score || (score === best.score && g.name.localeCompare(best.guide.name) < 0)) {
      best = { guide: g, score };
    }
  }
  return best?.guide ?? null;
}

/**
 * Answered questions with the section headings that introduce them; headings
 * with nothing answered beneath are dropped.
 */
export function answeredWithSections<R extends { answer: string | null; type?: string }>(
  responses: R[],
): R[] {
  const out: R[] = [];
  let heading: R | null = null;
  for (const r of responses) {
    if (r.type === "section") {
      heading = r;
      continue;
    }
    if (!r.answer || !r.answer.trim()) continue;
    if (heading) {
      out.push(heading);
      heading = null;
    }
    out.push(r);
  }
  return out;
}

/** Answers and uploaded files for these questions, read from a submitted form. */
export function readSubmission(
  fields: RecruitingFormField[],
  fd: FormData,
): { raw: RawAnswers; files: Map<string, File> } {
  const raw: RawAnswers = {};
  const files = new Map<string, File>();
  for (const f of fields) {
    if (!fieldIsAnswerable(f.type)) continue;
    if (f.type === "file") {
      const file = fd.get(`file_${f.id}`);
      if (file && typeof file === "object" && "size" in file && file.size > 0) {
        files.set(f.id, file as File);
      }
      continue;
    }
    const vals = fd.getAll(`a_${f.id}`).map((v) => String(v));
    raw[f.id] = f.type === "checkboxes" ? vals : vals[0];
  }
  return { raw, files };
}

/** Basic sanity check on an uploaded file. */
export function fileProblem(file: File): string | null {
  if (file.size > MAX_FORM_FILE_BYTES) return `${file.name} is larger than 15 MB.`;
  return null;
}

// ---------------------------------------------------------------------------
// Interview guides on the Interview Tracking tab
// ---------------------------------------------------------------------------

const CHECKBOX_JOIN = ", ";

/** Which options a stored checkboxes answer ("A, B") had ticked. */
export function checkedOptions(answer: string | null | undefined, options: string[]): string[] {
  if (!answer) return [];
  const parts = new Set(answer.split(CHECKBOX_JOIN).map((p) => p.trim()));
  return options.filter((o) => parts.has(o) || answer === o);
}

/**
 * The questions to render for an interview being edited: the snapshot it was
 * logged with. Older interviews stored plain question/answer pairs, which come
 * back as paragraph questions.
 */
export function responsesAsFields(responses: InterviewResponse[]): RecruitingFormField[] {
  const taken = new Set<string>();
  return responses.map((r, i) => {
    const type =
      r.type && FORM_FIELD_TYPES.some((t) => t.value === r.type) && r.type !== "file" ? r.type : "long_text";
    let id = r.id && /^[a-z0-9_]{1,40}$/i.test(r.id) ? r.id : `legacy_${i}`;
    if (taken.has(id)) id = `${id.slice(0, 32)}_${i}`;
    taken.add(id);
    return {
      id,
      type,
      label: r.question,
      description: r.description ?? null,
      required: false,
      options: fieldHasOptions(type) ? (r.options ?? []) : [],
    };
  });
}

/**
 * The interviewer's answers for a guide's questions (form inputs named
 * `a_<id>`), stored with a snapshot of each question. Section headings are
 * kept, with no answer, so the notes read in the guide's order.
 */
export function readInterviewResponses(fields: RecruitingFormField[], fd: FormData): InterviewResponse[] {
  return fields
    .filter((f) => f.type !== "file")
    .map((f) => {
      const vals = fd
        .getAll(`a_${f.id}`)
        .map((v) => String(v).trim())
        .filter(Boolean);
      const answer =
        f.type === "section"
          ? null
          : (f.type === "checkboxes" ? vals.join(CHECKBOX_JOIN) : (vals[0] ?? "")).slice(0, 10000) || null;
      return {
        id: f.id,
        question: f.label,
        answer,
        type: f.type,
        ...(fieldHasOptions(f.type) ? { options: f.options } : {}),
        description: f.description,
      };
    });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(v: string | null | undefined): boolean {
  return !!v && EMAIL_RE.test(v.trim());
}
