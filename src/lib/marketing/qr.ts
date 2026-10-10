/**
 * QR codes & their public capture forms.
 *
 * A QR code encodes `/q/<token>` — an opaque 16-char hex handle, never a row
 * id, so the public URL cannot be used to enumerate the database. Scanning it
 * renders the linked form (or redirects to `target_url`); submissions land in
 * greendogops.qr_lead.
 */

export type QrCodeType =
  | "event"
  | "ce"
  | "promo"
  | "partner"
  | "referral"
  | "rescue"
  | "influencer"
  | "other";

export const QR_CODE_TYPES: { value: QrCodeType; label: string; icon: string }[] = [
  { value: "event", label: "Event", icon: "🎪" },
  { value: "ce", label: "CE course", icon: "📋" },
  { value: "promo", label: "Promotion", icon: "🏷️" },
  { value: "partner", label: "Retail partner", icon: "🤝" },
  { value: "referral", label: "Referral clinic", icon: "🏥" },
  { value: "rescue", label: "Rescue / shelter", icon: "🐾" },
  { value: "influencer", label: "Influencer", icon: "⭐" },
  { value: "other", label: "Other", icon: "🔗" },
];

export type QrFieldType =
  | "text"
  | "email"
  | "phone"
  | "textarea"
  | "number"
  | "date"
  | "time"
  | "select"
  | "radio"
  | "multiselect"
  | "scale"
  | "checkbox"
  | "heading";

export const QR_FIELD_TYPES: { value: QrFieldType; label: string; group: string }[] = [
  { value: "text", label: "Short answer", group: "Text" },
  { value: "textarea", label: "Paragraph", group: "Text" },
  { value: "email", label: "Email", group: "Text" },
  { value: "phone", label: "Phone", group: "Text" },
  { value: "number", label: "Number", group: "Text" },
  { value: "select", label: "Dropdown", group: "Choice" },
  { value: "radio", label: "Multiple choice", group: "Choice" },
  { value: "multiselect", label: "Checkboxes (choose many)", group: "Choice" },
  { value: "scale", label: "Linear scale", group: "Choice" },
  { value: "checkbox", label: "Single checkbox (yes / no)", group: "Choice" },
  { value: "date", label: "Date", group: "Date & time" },
  { value: "time", label: "Time", group: "Date & time" },
  { value: "heading", label: "Section heading (no answer)", group: "Layout" },
];

/** Types whose answers come from a fixed option list. */
export const QR_CHOICE_TYPES: QrFieldType[] = ["select", "radio", "multiselect"];

export const fieldHasOptions = (t: QrFieldType): boolean => QR_CHOICE_TYPES.includes(t);

/** Options are edited one per line — commas are legitimate inside an answer. */
export const optionsFromText = (v: string): string[] =>
  v.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 50);

/**
 * What the options textarea should show. The raw draft is kept while it still
 * parses to the saved options, so a just-pressed Enter (empty trailing line)
 * or a trailing space isn't stripped mid-typing; any outside change to the
 * options (type switch, reorder, duplicate) wins over a stale draft.
 */
export const optionsTextFor = (draft: string, options: string[]): string => {
  const parsed = optionsFromText(draft);
  const same = parsed.length === options.length && parsed.every((o, i) => o === options[i]);
  return same ? draft : options.join("\n");
};

/** Heading blocks are rendered as copy, never submitted. */
export const fieldIsAnswerable = (t: QrFieldType): boolean => t !== "heading";

/** Sentinel an "Other…" choice posts; the free text rides alongside it. */
export const OTHER_VALUE = "__other__";

export const otherFieldName = (key: string): string => `custom_${key}__other`;

export const SCALE_MIN_FLOOR = 0;
export const SCALE_MAX_CEIL = 10;

/** One custom question on a capture form. */
export interface QrFormField {
  /** Stable key used for the answers jsonb. */
  key: string;
  label: string;
  type: QrFieldType;
  required: boolean;
  options: string[];
  placeholder: string | null;
  /** Help text shown under the question. */
  description: string | null;
  /** Choice questions can offer a free-text "Other…" escape hatch. */
  allowOther: boolean;
  /** Bounds for `number` and `scale`. */
  min: number | null;
  max: number | null;
  /** End captions for `scale`. */
  minLabel: string | null;
  maxLabel: string | null;
}

/** A question with every key populated — the only way fields should be built. */
export function newFormField(p: Partial<QrFormField> = {}): QrFormField {
  return {
    key: "",
    label: "",
    type: "text",
    required: false,
    options: [],
    placeholder: null,
    description: null,
    allowOther: false,
    min: null,
    max: null,
    minLabel: null,
    maxLabel: null,
    ...p,
  };
}

/** The 1–5 default keeps a scale usable the moment it is added. */
export const scaleRange = (f: QrFormField): number[] => {
  const min = Math.max(SCALE_MIN_FLOOR, Math.min(f.min ?? 1, SCALE_MAX_CEIL));
  const max = Math.max(min + 1, Math.min(f.max ?? 5, SCALE_MAX_CEIL));
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
};

export interface QrForm {
  id: string;
  name: string;
  headline: string | null;
  intro: string | null;
  success_message: string | null;
  collect_pet_name: boolean;
  collect_zip: boolean;
  fields: QrFormField[];
  theme: string;
  banner_url: string | null;
  post_submit_heading: string | null;
  show_confirmation: boolean;
  confirmation_note: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * What the success screen shows back to the person who just submitted. The
 * confirmation code is the point: at an event it is the only thing staff can
 * check before the leads list has refreshed, so it is minted by the database
 * on insert and read back rather than generated in the browser.
 */
export interface CaptureReceipt {
  confirmationCode: string;
  fullName: string;
  /** ISO timestamp of the insert, per the database clock. */
  submittedAt: string;
}

/**
 * Colour schemes a form can be dressed in. Stored as a key, never as raw CSS —
 * the public page is unauthenticated, so the class strings must come from this
 * fixed list rather than from anything an editor typed.
 */
export interface QrFormTheme {
  value: string;
  label: string;
  /** Swatch shown in the editor. */
  swatch: string;
  /** Page backdrop behind the card. */
  page: string;
  /** Solid band used as the header when there is no banner image. */
  band: string;
  button: string;
  accentText: string;
  focus: string;
  successIcon: string;
  /** Backdrop for the post-submission verification ticket. */
  ticket: string;
}

export const QR_FORM_THEMES: QrFormTheme[] = [
  {
    value: "emerald",
    label: "Green Dog green",
    swatch: "bg-emerald-600",
    page: "bg-gradient-to-b from-emerald-50 to-white",
    band: "bg-emerald-600",
    button: "bg-emerald-600 hover:bg-emerald-700",
    accentText: "text-emerald-700",
    focus: "focus:border-emerald-500 focus:ring-emerald-500",
    successIcon: "bg-emerald-100 text-emerald-600",
    ticket: "border-emerald-300 bg-emerald-50",
  },
  {
    value: "sky",
    label: "Sky blue",
    swatch: "bg-sky-600",
    page: "bg-gradient-to-b from-sky-50 to-white",
    band: "bg-sky-600",
    button: "bg-sky-600 hover:bg-sky-700",
    accentText: "text-sky-700",
    focus: "focus:border-sky-500 focus:ring-sky-500",
    successIcon: "bg-sky-100 text-sky-600",
    ticket: "border-sky-300 bg-sky-50",
  },
  {
    value: "violet",
    label: "Violet",
    swatch: "bg-violet-600",
    page: "bg-gradient-to-b from-violet-50 to-white",
    band: "bg-violet-600",
    button: "bg-violet-600 hover:bg-violet-700",
    accentText: "text-violet-700",
    focus: "focus:border-violet-500 focus:ring-violet-500",
    successIcon: "bg-violet-100 text-violet-600",
    ticket: "border-violet-300 bg-violet-50",
  },
  {
    value: "amber",
    label: "Warm amber",
    swatch: "bg-amber-500",
    page: "bg-gradient-to-b from-amber-50 to-white",
    band: "bg-amber-500",
    button: "bg-amber-500 hover:bg-amber-600",
    accentText: "text-amber-700",
    focus: "focus:border-amber-500 focus:ring-amber-500",
    successIcon: "bg-amber-100 text-amber-600",
    ticket: "border-amber-300 bg-amber-50",
  },
  {
    value: "rose",
    label: "Rose",
    swatch: "bg-rose-500",
    page: "bg-gradient-to-b from-rose-50 to-white",
    band: "bg-rose-500",
    button: "bg-rose-500 hover:bg-rose-600",
    accentText: "text-rose-700",
    focus: "focus:border-rose-500 focus:ring-rose-500",
    successIcon: "bg-rose-100 text-rose-600",
    ticket: "border-rose-300 bg-rose-50",
  },
  {
    value: "slate",
    label: "Charcoal",
    swatch: "bg-slate-800",
    page: "bg-gradient-to-b from-slate-100 to-white",
    band: "bg-slate-800",
    button: "bg-slate-800 hover:bg-slate-900",
    accentText: "text-slate-800",
    focus: "focus:border-slate-500 focus:ring-slate-500",
    successIcon: "bg-slate-200 text-slate-700",
    ticket: "border-slate-400 bg-slate-50",
  },
];

export const qrFormTheme = (v: string | null | undefined): QrFormTheme =>
  QR_FORM_THEMES.find((t) => t.value === v) ?? QR_FORM_THEMES[0];

export interface QrCode {
  id: string;
  token: string;
  label: string;
  code_type: string;
  event_id: string | null;
  ce_event_id: string | null;
  promotion_id: string | null;
  org_id: string | null;
  referral_partner_id: string | null;
  influencer_id: string | null;
  form_id: string | null;
  target_url: string | null;
  active: boolean;
  notes: string | null;
  scan_count: number;
  last_scanned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QrLead {
  id: string;
  qr_code_id: string;
  event_id: string | null;
  ce_event_id: string | null;
  org_id: string | null;
  referral_partner_id: string | null;
  influencer_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  pet_name: string | null;
  zip: string | null;
  answers: Record<string, string>;
  status: string;
  notes: string | null;
  source: string;
  confirmation_code: string | null;
  scanned_at: string;
  created_at: string;
  updated_at: string;
}

export const QR_LEAD_STATUSES: { value: string; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "booked", label: "Booked" },
  { value: "client", label: "Became a client" },
  { value: "invalid", label: "Invalid" },
];

export const QR_LEAD_STATUS_COLORS: Record<string, string> = {
  new: "bg-sky-50 text-sky-700",
  contacted: "bg-amber-50 text-amber-700",
  booked: "bg-violet-50 text-violet-700",
  client: "bg-emerald-50 text-emerald-700",
  invalid: "bg-slate-100 text-slate-500",
};

export const qrLeadStatusLabel = (v: string | null): string =>
  QR_LEAD_STATUSES.find((s) => s.value === v)?.label ?? v ?? "—";

export const qrCodeTypeLabel = (v: string | null): string =>
  QR_CODE_TYPES.find((t) => t.value === v)?.label ?? v ?? "—";

/**
 * A record that can own QR codes from its own detail dialog. Retail partners
 * are deliberately absent: their codes are auto-created from the org row and
 * edited through the Non-Med Partner CRM's own QR tab.
 */
export type QrSubjectKind = "event" | "ce" | "promo" | "referral" | "rescue" | "influencer";

export interface QrSubject {
  kind: QrSubjectKind;
  id: string;
  name: string;
}

/** The qr_code / qr_lead column that links a row to each kind of subject. */
export const QR_SUBJECT_COLUMN: Record<QrSubjectKind, string> = {
  event: "event_id",
  ce: "ce_event_id",
  promo: "promotion_id",
  referral: "referral_partner_id",
  rescue: "org_id",
  influencer: "influencer_id",
};

/** The codes belonging to one record. */
export function codesForSubject(codes: QrCode[], subject: QrSubject | null): QrCode[] {
  if (!subject) return [];
  const column = QR_SUBJECT_COLUMN[subject.kind] as keyof QrCode;
  return codes.filter((c) => c[column] === subject.id);
}

/** Public scan URL for a QR code token. */
export function qrScanUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/q/${token}`;
}

/**
 * The URL actually encoded in a printed code. Retail partner codes were
 * printed against /lead/<token> before qr_code existed; migration 0208 gave
 * them a qr_code row keyed by that same token, so they must keep showing (and
 * being downloaded as) the /lead/ form of the URL.
 */
export function qrPublicUrl(
  origin: string,
  code: Pick<QrCode, "token" | "code_type" | "org_id">,
): string {
  const base = origin.replace(/\/$/, "");
  return code.code_type === "partner" && code.org_id
    ? `${base}/lead/${code.token}`
    : `${base}/q/${code.token}`;
}

/**
 * Turn a question label into a stable answer key. Keys are what the answers
 * jsonb is keyed by, so renaming a label keeps existing answers readable only
 * if the key is preserved — callers generate the key once, on creation.
 */
export function slugifyFieldKey(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || `field_${Math.random().toString(36).slice(2, 8)}`;
}

/** The questions a brand-new event form starts with. */
export function defaultEventFormFields(): QrFormField[] {
  return [
    newFormField({
      key: "interest",
      label: "What are you most interested in?",
      type: "radio",
      options: ["Dental cleaning", "Wellness exam", "Grooming", "Just saying hi"],
    }),
    newFormField({
      key: "opt_in",
      label: "Email me Green Dog news & offers",
      type: "checkbox",
    }),
  ];
}

/** A CE course code captures the attendee details CE Broker rosters need. */
export function defaultCeFormFields(): QrFormField[] {
  return [
    newFormField({ key: "practice", label: "Practice / clinic", type: "text" }),
    newFormField({
      key: "role",
      label: "Your role",
      type: "select",
      options: ["Veterinarian", "Technician", "Assistant", "Practice manager", "Student"],
      allowOther: true,
    }),
    newFormField({
      key: "license",
      label: "License number (for CE credit)",
      type: "text",
    }),
  ];
}

/** A referral clinic hands this to a client they are sending to Green Dog. */
export function defaultReferralFormFields(): QrFormField[] {
  return [
    newFormField({
      key: "referred_by",
      label: "Who referred you?",
      type: "text",
      placeholder: "Doctor or staff member",
    }),
    newFormField({
      key: "reason",
      label: "What does your pet need?",
      type: "radio",
      options: [
        "Dental cleaning",
        "Extractions / oral surgery",
        "Second opinion",
        "Not sure yet",
      ],
    }),
  ];
}

/** Rescue & shelter codes go out with an adopter's paperwork. */
export function defaultRescueFormFields(): QrFormField[] {
  return [
    newFormField({ key: "adoption_date", label: "When did you adopt?", type: "date" }),
    newFormField({
      key: "interest",
      label: "What are you most interested in?",
      type: "radio",
      options: ["New adopter exam", "Dental cleaning", "Wellness exam", "Just saying hi"],
    }),
  ];
}

/** An influencer's code goes in their bio, stories and printed collateral. */
export function defaultInfluencerFormFields(): QrFormField[] {
  return [
    newFormField({
      key: "platform",
      label: "Where did you find us?",
      type: "radio",
      options: ["Instagram", "TikTok", "YouTube", "Facebook", "In person"],
      allowOther: true,
    }),
    newFormField({
      key: "interest",
      label: "What are you most interested in?",
      type: "multiselect",
      options: ["Dental cleaning", "Wellness exam", "Grooming", "Just saying hi"],
    }),
    newFormField({
      key: "opt_in",
      label: "Email me Green Dog news & offers",
      type: "checkbox",
    }),
  ];
}

/** Promotion codes are printed on the flyer for the offer itself. */
export function defaultPromoFormFields(): QrFormField[] {
  return [
    newFormField({
      key: "opt_in",
      label: "Email me Green Dog news & offers",
      type: "checkbox",
    }),
  ];
}

/** Coerce an untrusted jsonb value into QrFormField[]. */
export function parseFormFields(raw: unknown): QrFormField[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(QR_FIELD_TYPES.map((t) => t.value));
  const out: QrFormField[] = [];
  const seen = new Set<string>();
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v)
      ? v
      : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
        ? Number(v)
        : null;
  const str = (v: unknown, max: number): string | null =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!label) continue;
    const type = allowed.has(r.type as QrFieldType) ? (r.type as QrFieldType) : "text";

    // Answers are keyed by `key`, so a duplicate would silently overwrite.
    let key = typeof r.key === "string" && r.key ? r.key : slugifyFieldKey(label);
    if (seen.has(key)) {
      let n = 2;
      while (seen.has(`${key}_${n}`)) n += 1;
      key = `${key}_${n}`;
    }
    seen.add(key);

    out.push(
      newFormField({
        key,
        label: label.slice(0, 160),
        type,
        required: r.required === true,
        options: fieldHasOptions(type) && Array.isArray(r.options)
          ? r.options.map((o) => String(o).slice(0, 80)).filter(Boolean).slice(0, 50)
          : [],
        placeholder: str(r.placeholder, 120),
        description: str(r.description, 300),
        allowOther: fieldHasOptions(type) && r.allowOther === true,
        min: num(r.min),
        max: num(r.max),
        minLabel: str(r.minLabel, 40),
        maxLabel: str(r.maxLabel, 40),
      }),
    );
    if (out.length >= 50) break;
  }
  return out;
}

const MAX_ANSWER_LENGTH = 500;

/**
 * Collect the answers to a form's custom questions from an untrusted public
 * submission. Only keys the form actually declares are read, choice answers
 * must match a declared option, and every value is clamped.
 */
export function readFormAnswers(
  fields: QrFormField[],
  formData: FormData,
): { answers: Record<string, string> } | { error: string } {
  const answers: Record<string, string> = {};
  const clamp = (s: string) => (s.length > MAX_ANSWER_LENGTH ? s.slice(0, MAX_ANSWER_LENGTH) : s);
  const missing = (f: QrFormField) => ({ error: `Please answer: ${f.label}` });

  for (const f of fields) {
    if (!fieldIsAnswerable(f.type)) continue;
    const name = `custom_${f.key}`;
    let value = "";

    if (f.type === "checkbox") {
      const raw = formData.get(name);
      value = raw === "on" || raw === "true" ? "Yes" : "No";
      if (f.required && value === "No") return missing(f);
    } else if (f.type === "multiselect") {
      const picked: string[] = [];
      for (const raw of formData.getAll(name)) {
        const v = String(raw).trim();
        if (!v) continue;
        if (v === OTHER_VALUE) {
          const other = String(formData.get(otherFieldName(f.key)) ?? "").trim();
          if (!f.allowOther) return { error: `Please answer: ${f.label}` };
          if (other) picked.push(clamp(other));
          continue;
        }
        if (!f.options.includes(v)) {
          return { error: "Please choose from the listed options." };
        }
        picked.push(v);
      }
      if (f.required && picked.length === 0) return missing(f);
      value = clamp(picked.join(", "));
    } else if (f.type === "select" || f.type === "radio") {
      const raw = String(formData.get(name) ?? "").trim();
      if (raw === OTHER_VALUE) {
        if (!f.allowOther) return { error: "Please choose from the listed options." };
        value = clamp(String(formData.get(otherFieldName(f.key)) ?? "").trim());
        if (f.required && !value) return missing(f);
      } else if (raw && !f.options.includes(raw)) {
        return { error: "Please choose from the listed options." };
      } else {
        value = raw;
        if (f.required && !value) return missing(f);
      }
    } else if (f.type === "scale") {
      const raw = String(formData.get(name) ?? "").trim();
      if (raw) {
        const allowedSteps = scaleRange(f);
        if (!allowedSteps.includes(Number(raw))) {
          return { error: `Please choose a value for: ${f.label}` };
        }
      }
      value = raw;
      if (f.required && !value) return missing(f);
    } else if (f.type === "number") {
      const raw = String(formData.get(name) ?? "").trim();
      if (raw) {
        const n = Number(raw);
        if (!Number.isFinite(n)) return { error: `Please enter a number for: ${f.label}` };
        if (f.min != null && n < f.min) return { error: `${f.label} must be at least ${f.min}.` };
        if (f.max != null && n > f.max) return { error: `${f.label} must be at most ${f.max}.` };
        value = String(n);
      }
      if (f.required && !value) return missing(f);
    } else if (f.type === "date" || f.type === "time") {
      const raw = String(formData.get(name) ?? "").trim();
      const shape = f.type === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{2}:\d{2}$/;
      if (raw && !shape.test(raw)) return { error: `Please check the ${f.type} for: ${f.label}` };
      value = raw;
      if (f.required && !value) return missing(f);
    } else {
      value = clamp(String(formData.get(name) ?? "").trim());
      if (f.required && !value) return missing(f);
    }

    if (value !== "") answers[f.key] = value;
  }
  return { answers };
}
