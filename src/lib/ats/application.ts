// ---------------------------------------------------------------------------
// Website application details (the greendog careers "Apply" form).
//
// One schema drives everything: the careers-form email parser maps form labels
// onto these keys, the candidate profile renders the Application and
// Experience & Skills tabs from it, and the profile's edit mode posts back the
// same keys. Stored as one JSON document on person_recruiting.application.
//
// Matching is label-based: a form field lands here when its label (or one of
// its aliases) matches, ignoring case, punctuation and "(hints)". Anything the
// form sends that isn't recognized is kept under `extra` so nothing is lost.
//
// Kept free of server-only imports so it can be unit-tested and used client-side.
// ---------------------------------------------------------------------------

import { normalizeJobLocation, normalizeSource } from "./normalize";

export type AppFieldType =
  | "text"
  | "longtext"
  | "select"
  | "multi"
  | "yesno"
  | "ack"
  | "date"
  | "number"
  | "url";

/** Role families used to show role-specific questions. */
export type RoleGroup = "dvm" | "rvt" | "clinical" | "csr" | "remote" | "mobile" | "intern";

export type AppTab = "application" | "experience";

export interface AppField {
  key: string;
  label: string;
  type: AppFieldType;
  options?: readonly string[];
  /** Other form labels accepted for this field. */
  aliases?: readonly string[];
  /** For yes/no questions: the answer that is a good sign (colors the badge). */
  good?: "Yes" | "No";
  /** Only asked for these roles (always shown when it has an answer). */
  roles?: readonly RoleGroup[];
}

export interface AppSection {
  key: string;
  title: string;
  tab: AppTab;
  roles?: readonly RoleGroup[];
  fields: readonly AppField[];
}

export interface AppListField {
  key: string;
  label: string;
  type: "text" | "longtext" | "date" | "yesno" | "select";
  options?: readonly string[];
  /** Form label with `{n}` for the entry number, e.g. "Employer {n}". */
  template: string;
}

export interface AppListDef {
  key: "employment" | "references";
  title: string;
  tab: AppTab;
  max: number;
  fields: readonly AppListField[];
}

export interface SkillGrid {
  key: string;
  title: string;
  roles: readonly RoleGroup[];
  skills: ReadonlyArray<{ key: string; label: string }>;
}

export type AppAnswer = string | string[];
export type AppListEntry = Record<string, string>;

export interface LanguageEntry {
  language: string;
  fluency: string | null;
}

export interface ApplicationDetails {
  /** Flat answers keyed by AppField.key. */
  answers?: Record<string, AppAnswer>;
  employment?: AppListEntry[];
  references?: AppListEntry[];
  languages?: LanguageEntry[];
  /** Skill key → SKILL_LEVELS value. */
  skills?: Record<string, string>;
  /** Form fields that didn't match the schema, kept verbatim. */
  extra?: Array<{ label: string; value: string }>;
  /** ISO timestamp the website application was received. */
  received_at?: string;
}

// ---------------------------------------------------------------------------
// Option lists
// ---------------------------------------------------------------------------

export const LOCATION_OPTIONS = [
  "Sherman Oaks",
  "Van Nuys",
  "Venice",
  "Mobile (My Pet Mobile Vet)",
  "Remote",
  "Open to any",
] as const;
const YEARS_OPTIONS = ["None", "Under 1", "1–2", "3–5", "6–10", "10+"] as const;
export const DAY_OPTIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const SKILL_LEVELS = ["None", "Learning", "Competent", "Can Train Others"] as const;
export const FLUENCY_OPTIONS = ["Basic", "Conversational", "Fluent"] as const;
const SOURCE_CHOICES = [
  "Indeed",
  "ZipRecruiter",
  "GD Website",
  "LinkedIn",
  "Facebook",
  "Social Media",
  "Personal Referral",
  "College / School",
  "Walk-in",
  "Other",
] as const;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const APPLICATION_SECTIONS: readonly AppSection[] = [
  {
    key: "position",
    title: "Position & availability",
    tab: "application",
    fields: [
      {
        key: "locations",
        label: "Practice/Location",
        type: "multi",
        options: LOCATION_OPTIONS,
        aliases: ["Location", "Locations", "Preferred Location"],
      },
      {
        key: "employment_types",
        label: "Employment Type Desired",
        type: "multi",
        options: ["Full-Time", "Part-Time", "Per Diem", "Contractor"],
        aliases: ["Employment Type"],
      },
      {
        key: "start_date",
        label: "Earliest Start Date",
        type: "date",
        aliases: ["Start Date", "Available Start Date"],
      },
      {
        key: "desired_pay",
        label: "Desired Pay",
        type: "text",
        aliases: ["Desired Pay Rate", "Expected Pay", "Pay Expectations"],
      },
      {
        key: "pay_basis",
        label: "Pay Type",
        type: "select",
        options: ["Hourly", "Annual"],
        aliases: ["Desired Pay Type", "Pay Basis"],
      },
      {
        key: "hours_per_week",
        label: "Desired Hours per Week",
        type: "select",
        options: ["Under 20", "20–29", "30–36", "37–40", "40+"],
        aliases: ["Hours per Week"],
      },
      {
        key: "days_available",
        label: "Days Available",
        type: "multi",
        options: DAY_OPTIONS,
      },
      {
        key: "shifts",
        label: "Shifts Available",
        type: "multi",
        options: ["Mornings", "Mid-day", "Evenings", "Weekends", "Holidays"],
        aliases: ["Shift Availability"],
      },
      {
        key: "career_goal",
        label: "What kind of role are you looking for?",
        type: "select",
        options: ["Long-term career", "1–2 years", "Temporary/Seasonal", "Unsure"],
        aliases: ["Role Type", "Looking For"],
      },
      {
        key: "heard_about",
        label: "How did you hear about us?",
        type: "select",
        options: SOURCE_CHOICES,
        aliases: ["How did you hear about this job?"],
      },
      { key: "referred_by", label: "Referred By", type: "text", aliases: ["Referral Name"] },
      {
        key: "schedule_restrictions",
        label: "Schedule Restrictions",
        type: "longtext",
      },
    ],
  },
  {
    key: "contact",
    title: "Contact & preferences",
    tab: "application",
    fields: [
      { key: "preferred_name", label: "Preferred Name", type: "text" },
      {
        key: "text_ok",
        label: "OK to text you about scheduling?",
        type: "yesno",
        good: "Yes",
        aliases: ["OK to Text", "Text OK"],
      },
      { key: "street_address", label: "Street Address", type: "text", aliases: ["Address"] },
      {
        key: "best_time",
        label: "Best Time to Contact",
        type: "multi",
        options: ["Morning", "Afternoon", "Evening"],
      },
      {
        key: "linkedin",
        label: "LinkedIn / Portfolio URL",
        type: "url",
        aliases: ["LinkedIn", "LinkedIn URL", "Portfolio", "Portfolio URL", "Website"],
      },
    ],
  },
  {
    key: "eligibility",
    title: "Eligibility",
    tab: "application",
    fields: [
      {
        key: "age_18",
        label: "Are you 18 or older?",
        type: "yesno",
        good: "Yes",
        aliases: ["18 or Older", "Over 18"],
      },
      {
        key: "work_authorized",
        label: "Are you legally authorized to work in the U.S.?",
        type: "yesno",
        good: "Yes",
        aliases: ["Authorized to Work in the US", "Work Authorization"],
      },
      {
        key: "needs_sponsorship",
        label: "Will you now or in the future require visa sponsorship?",
        type: "yesno",
        good: "No",
        aliases: ["Visa Sponsorship", "Requires Sponsorship"],
      },
      {
        key: "reliable_transport",
        label: "Do you have reliable transportation to the location(s) you selected?",
        type: "yesno",
        good: "Yes",
        aliases: ["Reliable Transportation"],
      },
      {
        key: "can_lift",
        label:
          "Can you lift 40–50 lbs and safely restrain animals, with or without reasonable accommodation?",
        type: "yesno",
        good: "Yes",
        roles: ["clinical", "dvm"],
        aliases: ["Lift 40-50 lbs", "Physical Requirements"],
      },
      {
        key: "exposure_ok",
        label:
          "Are you comfortable with exposure to blood, animal waste, euthanasia, X-rays and anesthetic gases?",
        type: "yesno",
        good: "Yes",
        roles: ["clinical", "dvm"],
        aliases: ["Clinical Exposure"],
      },
      {
        key: "drivers_license",
        label: "Do you have a valid driver's license and a clean driving record?",
        type: "yesno",
        good: "Yes",
        roles: ["mobile"],
        aliases: ["Valid Driver's License", "Driver's License"],
      },
      {
        key: "previously_applied",
        label: "Have you worked for or applied to Green Dog before?",
        type: "yesno",
        aliases: ["Previously Applied", "Worked for Green Dog Before"],
      },
      {
        key: "previously_applied_detail",
        label: "When / which role?",
        type: "text",
        aliases: ["Previous Green Dog Role"],
      },
    ],
  },
  {
    key: "responses",
    title: "Written responses",
    tab: "application",
    fields: [
      {
        key: "why_green_dog",
        label: "Why Green Dog, and why this role?",
        type: "longtext",
        aliases: ["Why Green Dog"],
      },
      {
        key: "difficult_situation",
        label: "Describe a time you handled a difficult client or coworker.",
        type: "longtext",
        aliases: ["Difficult Client or Coworker"],
      },
      {
        key: "reliability",
        label: "How would past managers describe your reliability and attendance?",
        type: "longtext",
        aliases: ["Reliability"],
      },
      {
        key: "coworkers_say",
        label:
          "What would coworkers say is the best thing about working with you, and one thing to improve?",
        type: "longtext",
        aliases: ["Team Fit"],
      },
      {
        key: "growth",
        label: "What role do you hope to grow into?",
        type: "longtext",
        aliases: ["Growth", "Career Goals"],
      },
      {
        key: "anything_else",
        label: "Anything else you'd like us to know?",
        type: "longtext",
        aliases: ["Anything Else", "Additional Information"],
      },
    ],
  },
  {
    key: "acknowledgements",
    title: "Acknowledgements & signature",
    tab: "application",
    fields: [
      {
        key: "certify",
        label: "I certify the information provided is true and complete",
        type: "ack",
        aliases: ["Certification"],
      },
      {
        key: "privacy_notice",
        label: "I have read the Applicant Privacy Notice",
        type: "ack",
        aliases: ["Privacy Notice"],
      },
      {
        key: "sms_consent",
        label: "I agree to receive texts and emails about my application",
        type: "ack",
        aliases: ["SMS Consent", "Text Consent"],
      },
      {
        key: "at_will",
        label: "I understand employment with Green Dog is at-will",
        type: "ack",
        aliases: ["At-Will Acknowledgement", "At-Will"],
      },
      { key: "signature", label: "Electronic Signature", type: "text", aliases: ["Signature"] },
      {
        key: "signed_date",
        label: "Date",
        type: "date",
        aliases: ["Date Signed", "Signature Date"],
      },
    ],
  },
  {
    key: "tracking",
    title: "Posting & tracking",
    tab: "application",
    fields: [
      { key: "source", label: "Source", type: "text" },
      { key: "job_id", label: "Job ID", type: "text", aliases: ["Requisition", "Job Requisition"] },
      { key: "utm_source", label: "UTM Source", type: "text" },
      { key: "utm_medium", label: "UTM Medium", type: "text" },
      { key: "utm_campaign", label: "UTM Campaign", type: "text" },
    ],
  },
  {
    key: "experience",
    title: "Experience",
    tab: "experience",
    fields: [
      {
        key: "years_vet",
        label: "Years of Veterinary Experience",
        type: "select",
        options: YEARS_OPTIONS,
        aliases: ["Veterinary Experience"],
      },
      {
        key: "years_cs",
        label: "Years of Customer Service Experience",
        type: "select",
        options: YEARS_OPTIONS,
        aliases: ["Customer Service Experience"],
      },
      {
        key: "current_employer",
        label: "Current / Most Recent Employer",
        type: "text",
        aliases: ["Current Employer", "Most Recent Employer"],
      },
      {
        key: "current_title",
        label: "Current / Most Recent Title",
        type: "text",
        aliases: ["Current Title", "Most Recent Title"],
      },
      {
        key: "software",
        label: "Veterinary Software Used",
        type: "multi",
        options: [
          "ezyVet",
          "AVImark",
          "Cornerstone",
          "ImproMed",
          "Shepherd",
          "eVetPractice",
          "None",
        ],
        aliases: ["Veterinary Software", "Practice Management Software"],
      },
      {
        key: "other_tools",
        label: "Other Tools",
        type: "multi",
        options: ["Google Workspace", "Microsoft Office", "Slack", "Weave/RingCentral", "None"],
      },
    ],
  },
  {
    key: "education",
    title: "Education & credentials",
    tab: "experience",
    fields: [
      {
        key: "highest_education",
        label: "Highest Education",
        type: "select",
        options: [
          "High School/GED",
          "Some College",
          "Vet Assistant Certificate",
          "Associate's",
          "Bachelor's",
          "DVM/VMD",
          "Other",
        ],
        aliases: ["Highest Level of Education", "Education"],
      },
      { key: "school", label: "School / Program", type: "text", aliases: ["School", "Program"] },
      { key: "grad_year", label: "Graduation Year", type: "text" },
      {
        key: "certifications",
        label: "Certifications",
        type: "multi",
        options: ["RVT (CA)", "Fear Free", "Low Stress Handling", "RECOVER CPR", "VTS"],
      },
    ],
  },
  {
    key: "dvm",
    title: "Doctor (DVM) details",
    tab: "experience",
    roles: ["dvm"],
    fields: [
      {
        key: "dvm_license",
        label: "CA License #",
        type: "text",
        aliases: ["CA Veterinary License", "California License Number"],
      },
      { key: "dvm_states", label: "Other License States", type: "text" },
      { key: "dea", label: "DEA Registration", type: "yesno", good: "Yes" },
      { key: "vet_school", label: "Veterinary School", type: "text", aliases: ["Vet School"] },
      {
        key: "dvm_grad_year",
        label: "DVM Graduation Year",
        type: "text",
        aliases: ["Vet School Graduation Year"],
      },
      {
        key: "dvm_interests",
        label: "Areas of Interest",
        type: "multi",
        options: [
          "Dentistry",
          "Surgery",
          "Internal Medicine",
          "Urgent Care",
          "Exotics",
          "Ophthalmology",
          "Mobile",
          "General Practice",
        ],
      },
      { key: "relief_ok", label: "Open to relief work?", type: "yesno", aliases: ["Relief Work"] },
    ],
  },
  {
    key: "rvt",
    title: "RVT license",
    tab: "experience",
    roles: ["rvt"],
    fields: [
      {
        key: "rvt_status",
        label: "RVT License Status",
        type: "select",
        options: ["Licensed", "Exam Scheduled", "Student", "Not Pursuing"],
        aliases: ["License Status"],
      },
      { key: "rvt_license", label: "RVT License #", type: "text", aliases: ["RVT License Number"] },
    ],
  },
  {
    key: "intern",
    title: "Foreign graduate",
    tab: "experience",
    roles: ["intern"],
    fields: [
      {
        key: "ecfvg_status",
        label: "ECFVG/PAVE Status",
        type: "select",
        options: ["Not started", "In progress", "Completed"],
      },
    ],
  },
  {
    key: "remote",
    title: "Remote setup",
    tab: "experience",
    roles: ["remote"],
    fields: [
      {
        key: "quiet_workspace",
        label: "Quiet dedicated workspace?",
        type: "yesno",
        good: "Yes",
        aliases: ["Quiet Workspace"],
      },
      {
        key: "internet_mbps",
        label: "Internet Speed (Mbps)",
        type: "number",
        aliases: ["Internet Speed"],
      },
      {
        key: "computer",
        label: "Computer",
        type: "select",
        options: ["Windows", "Mac", "Chromebook"],
      },
      { key: "headset", label: "Headset?", type: "yesno", good: "Yes", aliases: ["Headset"] },
    ],
  },
];

export const EMPLOYMENT_LIST: AppListDef = {
  key: "employment",
  title: "Employment history",
  tab: "experience",
  max: 3,
  fields: [
    { key: "employer", label: "Employer", type: "text", template: "Employer {n}" },
    { key: "title", label: "Title", type: "text", template: "Job Title {n}" },
    { key: "city", label: "City", type: "text", template: "Employer City {n}" },
    { key: "start", label: "Start", type: "text", template: "Start Date {n}" },
    { key: "end", label: "End", type: "text", template: "End Date {n}" },
    { key: "may_contact", label: "May we contact?", type: "yesno", template: "May We Contact {n}" },
    { key: "reason", label: "Reason for leaving", type: "text", template: "Reason for Leaving {n}" },
    { key: "duties", label: "Duties", type: "longtext", template: "Duties {n}" },
  ],
};

export const REFERENCES_LIST: AppListDef = {
  key: "references",
  title: "References",
  tab: "experience",
  max: 3,
  fields: [
    { key: "name", label: "Name", type: "text", template: "Reference {n} Name" },
    {
      key: "relationship",
      label: "Relationship",
      type: "select",
      options: ["Supervisor", "Coworker", "Instructor", "Other"],
      template: "Reference {n} Relationship",
    },
    { key: "company", label: "Company", type: "text", template: "Reference {n} Company" },
    { key: "phone", label: "Phone", type: "text", template: "Reference {n} Phone" },
    { key: "email", label: "Email", type: "text", template: "Reference {n} Email" },
  ],
};

export const APPLICATION_LISTS: readonly AppListDef[] = [EMPLOYMENT_LIST, REFERENCES_LIST];

export const SKILL_GRIDS: readonly SkillGrid[] = [
  {
    key: "clinical",
    title: "Clinical skills",
    roles: ["clinical"],
    skills: [
      { key: "restraint", label: "Restraint" },
      { key: "venipuncture", label: "Venipuncture" },
      { key: "iv_catheters", label: "IV Catheters" },
      { key: "anesthesia", label: "Anesthesia Monitoring" },
      { key: "dental_cleaning", label: "Dental Cleaning/Charting" },
      { key: "dental_rads", label: "Dental Radiographs" },
      { key: "radiology", label: "Radiology" },
      { key: "in_house_lab", label: "In-House Lab" },
      { key: "surgical", label: "Surgical Prep/Assist" },
      { key: "dosage", label: "Dosage Calculations" },
      { key: "exotics", label: "Exotics Handling" },
    ],
  },
  {
    key: "csr",
    title: "Client service skills",
    roles: ["csr"],
    skills: [
      { key: "phones", label: "Multi-line Phones" },
      { key: "scheduling", label: "Scheduling" },
      { key: "check_in_out", label: "Check-in/Check-out" },
      { key: "payments", label: "Payments" },
      { key: "estimates", label: "Estimates/Treatment Plans" },
      { key: "upset_clients", label: "Handling Upset Clients" },
    ],
  },
];

export const LANGUAGES_LABEL = "Languages Spoken";
export const LANGUAGE_OPTIONS = ["English", "Spanish", "Armenian", "Farsi", "Russian"] as const;
export const LANGUAGES_MAX = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLINICAL_TITLE =
  /\b(vet(erinary)? tech|technician|rvt|assistant|dental|kennel|clinic tech|extern|mobile)\b/i;

/** Role families for a target title, used to show role-specific sections. */
export function roleGroupsFor(title: string | null | undefined): Set<RoleGroup> {
  const t = (title ?? "").toLowerCase();
  const out = new Set<RoleGroup>();
  if (!t) return out;
  if (/\bdvm\b|veterinarian/.test(t)) out.add("dvm");
  if (/\brvt\b/.test(t)) out.add("rvt");
  if (CLINICAL_TITLE.test(t) && !/(executive|recruiting) assistant/.test(t)) out.add("clinical");
  if (/\bcsr\b|client serv|recep/.test(t)) out.add("csr");
  if (/remote/.test(t)) out.add("remote");
  if (/mobile|driver/.test(t)) out.add("mobile");
  if (/intern\b/.test(t)) out.add("intern");
  return out;
}

export function rolesMatch(
  roles: readonly RoleGroup[] | undefined,
  groups: Set<RoleGroup>,
): boolean {
  return !roles || roles.some((r) => groups.has(r));
}

export function hasAnswer(v: AppAnswer | null | undefined): boolean {
  if (v == null) return false;
  return Array.isArray(v) ? v.length > 0 : v.trim() !== "";
}

function entryHasData(e: AppListEntry): boolean {
  return Object.values(e).some((v) => v && v.trim() !== "");
}

/** True when the application holds anything worth showing. */
export function applicationHasData(app: ApplicationDetails | null | undefined): boolean {
  if (!app) return false;
  return (
    Object.values(app.answers ?? {}).some(hasAnswer) ||
    (app.employment ?? []).some(entryHasData) ||
    (app.references ?? []).some(entryHasData) ||
    (app.languages ?? []).length > 0 ||
    Object.keys(app.skills ?? {}).length > 0 ||
    (app.extra ?? []).length > 0
  );
}

/** Answered by the old basic careers form too, so not on its own an "application". */
const BASIC_FORM_KEYS = new Set(["locations"]);

/**
 * True when a website submission carries more than the basic careers form
 * (name / contact / role / location), i.e. it's worth storing and showing.
 */
export function isFullApplication(app: ApplicationDetails | null | undefined): boolean {
  if (!app) return false;
  const answers = Object.fromEntries(
    Object.entries(app.answers ?? {}).filter(([k]) => !BASIC_FORM_KEYS.has(k)),
  );
  return applicationHasData({ ...app, answers });
}

/** Display text for one answer. */
export function answerText(v: AppAnswer | null | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? v.join(", ") : v;
}

/** Comparison key: lower-case, "(hints)" dropped, punctuation → spaces. */
export function matchKey(label: string): string {
  return label
    .replace(/\(.*?\)/g, " ")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchOption(raw: string, options: readonly string[] | undefined): string {
  const v = raw.trim();
  if (!options) return v;
  const k = matchKey(v);
  const exact = options.find((o) => matchKey(o) === k);
  if (exact) return exact;
  // "Monday" → "Mon", "Mobile" → "Mobile (My Pet Mobile Vet)".
  const prefix = options.find((o) => {
    const ok = matchKey(o);
    const shorter = Math.min(ok.length, k.length);
    return shorter >= 3 && (k.startsWith(ok) || ok.startsWith(k));
  });
  return prefix ?? v;
}

export function normalizeYesNo(raw: string): string {
  const s = raw.trim();
  if (/^(y|yes|true|1|checked|on|agreed?)$/i.test(s)) return "Yes";
  if (/^(n|no|false|0|unchecked|off)$/i.test(s)) return "No";
  return s;
}

/** A checked acknowledgement echoes back as "Yes", "1", "Checked" or its own text. */
function normalizeAck(raw: string): string | null {
  const s = raw.trim();
  if (!s || /^(n|no|false|0|unchecked|off)$/i.test(s)) return null;
  return "Yes";
}

/** "10/15/2026" → "2026-10-15"; anything unrecognized passes through. */
export function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return s;
}

function splitMulti(raw: string): string[] {
  return raw
    .split(/\r?\n|[,;|]/)
    .map((s) => s.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

/** Coerce one raw form value to the field's type; null when empty. */
export function coerceAnswer(field: AppField, raw: string): AppAnswer | null {
  const s = raw.trim();
  if (!s) return null;
  switch (field.type) {
    case "multi": {
      const vals = uniq(splitMulti(s).map((v) => matchOption(v, field.options)));
      return vals.length ? vals : null;
    }
    case "select":
      return matchOption(s, field.options);
    case "yesno":
      return normalizeYesNo(s);
    case "ack":
      return normalizeAck(s);
    case "date":
      return normalizeDate(s);
    default:
      return s;
  }
}

// ---------------------------------------------------------------------------
// Website form (label → value) → ApplicationDetails
// ---------------------------------------------------------------------------

export interface LabeledApplication {
  application: ApplicationDetails;
  /** matchKey()s of every label that was used. */
  consumed: Set<string>;
}

/**
 * Map form fields (label → cleaned value) onto the schema. Returns the
 * application plus the labels it used so the caller can keep the rest as
 * `extra`.
 */
export function applicationFromLabels(fields: Map<string, string>): LabeledApplication {
  const byKey = new Map<string, { label: string; value: string }>();
  for (const [label, value] of fields) {
    const k = matchKey(label);
    if (!byKey.has(k)) byKey.set(k, { label, value });
  }
  const consumed = new Set<string>();
  const take = (...labels: string[]): string | null => {
    for (const l of labels) {
      const k = matchKey(l);
      const hit = byKey.get(k);
      if (hit && hit.value.trim()) {
        consumed.add(k);
        return hit.value;
      }
    }
    return null;
  };

  const answers: Record<string, AppAnswer> = {};
  for (const section of APPLICATION_SECTIONS) {
    for (const field of section.fields) {
      const raw = take(field.label, ...(field.aliases ?? []));
      if (raw == null) continue;
      const v = coerceAnswer(field, raw);
      if (v != null && hasAnswer(v)) answers[field.key] = v;
    }
  }
  // "State-of-the-Art Veterinary Hospital in Van Nuys" → "Van Nuys".
  if (Array.isArray(answers.locations)) {
    answers.locations = uniq(
      answers.locations.map((l) => matchOption(normalizeJobLocation(l) ?? l, LOCATION_OPTIONS)),
    );
  }

  const lists: Partial<Record<AppListDef["key"], AppListEntry[]>> = {};
  for (const list of APPLICATION_LISTS) {
    const entries: AppListEntry[] = [];
    for (let n = 1; n <= list.max + 2; n++) {
      const entry: AppListEntry = {};
      for (const f of list.fields) {
        const raw = take(f.template.replace("{n}", String(n)));
        if (raw == null) continue;
        entry[f.key] = f.type === "yesno" ? normalizeYesNo(raw) : raw.trim();
      }
      if (entryHasData(entry)) entries.push(entry);
    }
    if (entries.length) lists[list.key] = entries;
  }

  const languages: LanguageEntry[] = [];
  const langRaw = take(LANGUAGES_LABEL, "Languages", "Language");
  if (langRaw) {
    for (const lang of uniq(splitMulti(langRaw).map((v) => matchOption(v, LANGUAGE_OPTIONS)))) {
      const fluency = take(`${lang} Fluency`);
      languages.push({
        language: lang,
        fluency: fluency ? matchOption(fluency, FLUENCY_OPTIONS) : null,
      });
    }
  }

  const skills: Record<string, string> = {};
  for (const grid of SKILL_GRIDS) {
    for (const s of grid.skills) {
      const raw = take(s.label, `${grid.title} ${s.label}`, `Skill ${s.label}`);
      if (raw) skills[s.key] = matchOption(raw, SKILL_LEVELS);
    }
  }

  const application: ApplicationDetails = {};
  if (Object.keys(answers).length) application.answers = answers;
  if (lists.employment) application.employment = lists.employment;
  if (lists.references) application.references = lists.references;
  if (languages.length) application.languages = languages;
  if (Object.keys(skills).length) application.skills = skills;
  return { application, consumed };
}

// ---------------------------------------------------------------------------
// Scalar columns derived from the application
// ---------------------------------------------------------------------------

const KNOWN_SOURCES = new Set<string>([...SOURCE_CHOICES, "Career Builder", "Recruiter Outreach", "Veterinary America"]);

export interface ApplicationScalars {
  source: string;
  sourceDetail: string | null;
  education: string | null;
  relevantExperience: string | null;
}

function one(v: AppAnswer | undefined): string | null {
  if (v == null) return null;
  const s = Array.isArray(v) ? v.join(", ") : v;
  return s.trim() || null;
}

/**
 * The summary columns the pipeline filters on, derived from a website
 * application. `source` comes from the hidden tracking field (per-ad URL) and
 * falls back to "How did you hear about us?", then "GD Website".
 */
export function applicationScalars(app: ApplicationDetails): ApplicationScalars {
  const a = app.answers ?? {};
  const fromTracking = normalizeSource(one(a.source));
  const fromHeard = normalizeSource(one(a.heard_about));
  const source =
    [fromTracking, fromHeard].find((s): s is string => !!s && KNOWN_SOURCES.has(s)) ??
    "GD Website";

  const detail = [
    "Website application",
    one(a.job_id) && `Job ${one(a.job_id)}`,
    one(a.utm_campaign) && `Campaign ${one(a.utm_campaign)}`,
    one(a.referred_by) && `Referred by ${one(a.referred_by)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const school = one(a.school);
  const grad = one(a.grad_year);
  const education =
    [one(a.highest_education), school && (grad ? `${school} (${grad})` : school)]
      .filter(Boolean)
      .join(" — ") || null;

  const title = one(a.current_title);
  const employer = one(a.current_employer);
  const years = one(a.years_vet);
  const relevantExperience =
    [
      title && employer ? `${title} at ${employer}` : (title ?? employer),
      years && years !== "None" && `${years} yrs veterinary`,
    ]
      .filter(Boolean)
      .join(" · ") || null;

  return { source, sourceDetail: detail, education, relevantExperience };
}

// ---------------------------------------------------------------------------
// Profile edit form → ApplicationDetails
// ---------------------------------------------------------------------------

/** Input name for a schema field on the profile edit form. */
export const appInputName = (key: string) => `app.${key}`;
export const appOtherInputName = (key: string) => `app.${key}.__other`;
export const appListInputName = (list: string, i: number, key: string) => `app.${list}.${i}.${key}`;
export const appSkillInputName = (key: string) => `app.skill.${key}`;
export const appLanguageInputName = (i: number, key: "language" | "fluency") =>
  `app.languages.${i}.${key}`;
/** Present only while the profile's application editor is open. */
export const APP_EDIT_MARKER = "application_edit";

/**
 * Rebuild the application from the profile's edit form. Fields the form
 * doesn't carry (unmatched `extra` answers, received_at) are kept from `base`.
 */
export function applicationFromFormData(
  fd: FormData,
  base: ApplicationDetails | null | undefined,
): ApplicationDetails {
  const str = (name: string) => {
    const v = fd.get(name);
    return v == null ? "" : String(v).trim();
  };

  const answers: Record<string, AppAnswer> = {};
  for (const section of APPLICATION_SECTIONS) {
    for (const field of section.fields) {
      const name = appInputName(field.key);
      if (field.type === "multi") {
        const checked = fd.getAll(name).map((v) => String(v).trim()).filter(Boolean);
        const other = splitMulti(str(appOtherInputName(field.key)));
        const vals = uniq([...checked, ...other]);
        if (vals.length) answers[field.key] = vals;
      } else if (field.type === "ack") {
        if (fd.get(name) != null) answers[field.key] = "Yes";
      } else {
        const v = str(name);
        if (v) answers[field.key] = v;
      }
    }
  }

  const out: ApplicationDetails = { ...(base ?? {}) };
  out.answers = answers;

  for (const list of APPLICATION_LISTS) {
    const entries: AppListEntry[] = [];
    for (let i = 0; i < 20; i++) {
      const present = list.fields.some((f) => fd.has(appListInputName(list.key, i, f.key)));
      if (!present) break;
      const entry: AppListEntry = {};
      for (const f of list.fields) {
        const v = str(appListInputName(list.key, i, f.key));
        if (v) entry[f.key] = v;
      }
      if (entryHasData(entry)) entries.push(entry);
    }
    out[list.key] = entries;
  }

  const languages: LanguageEntry[] = [];
  for (let i = 0; i < 20; i++) {
    if (!fd.has(appLanguageInputName(i, "language"))) break;
    const language = str(appLanguageInputName(i, "language"));
    if (language) {
      languages.push({ language, fluency: str(appLanguageInputName(i, "fluency")) || null });
    }
  }
  out.languages = languages;

  const skills: Record<string, string> = {};
  for (const grid of SKILL_GRIDS) {
    for (const s of grid.skills) {
      const v = str(appSkillInputName(s.key));
      if (v) skills[s.key] = v;
    }
  }
  out.skills = skills;
  return out;
}
