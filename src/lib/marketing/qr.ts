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
  | "select"
  | "checkbox";

export const QR_FIELD_TYPES: { value: QrFieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Paragraph" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "select", label: "Choose one" },
  { value: "checkbox", label: "Yes / no" },
];

/** One custom question on a capture form. */
export interface QrFormField {
  /** Stable key used for the answers jsonb. */
  key: string;
  label: string;
  type: QrFieldType;
  required: boolean;
  options: string[];
  placeholder: string | null;
}

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
  active: boolean;
  created_at: string;
  updated_at: string;
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
    {
      key: "interest",
      label: "What are you most interested in?",
      type: "select",
      required: false,
      options: ["Dental cleaning", "Wellness exam", "Grooming", "Just saying hi"],
      placeholder: null,
    },
    {
      key: "opt_in",
      label: "Email me Green Dog news & offers",
      type: "checkbox",
      required: false,
      options: [],
      placeholder: null,
    },
  ];
}

/** A CE course code captures the attendee details CE Broker rosters need. */
export function defaultCeFormFields(): QrFormField[] {
  return [
    {
      key: "practice",
      label: "Practice / clinic",
      type: "text",
      required: false,
      options: [],
      placeholder: null,
    },
    {
      key: "role",
      label: "Your role",
      type: "select",
      required: false,
      options: ["Veterinarian", "Technician", "Assistant", "Practice manager", "Student", "Other"],
      placeholder: null,
    },
    {
      key: "license",
      label: "License number (for CE credit)",
      type: "text",
      required: false,
      options: [],
      placeholder: null,
    },
  ];
}

/** A referral clinic hands this to a client they are sending to Green Dog. */
export function defaultReferralFormFields(): QrFormField[] {
  return [
    {
      key: "referred_by",
      label: "Who referred you?",
      type: "text",
      required: false,
      options: [],
      placeholder: "Doctor or staff member",
    },
    {
      key: "reason",
      label: "What does your pet need?",
      type: "select",
      required: false,
      options: [
        "Dental cleaning",
        "Extractions / oral surgery",
        "Second opinion",
        "Not sure yet",
      ],
      placeholder: null,
    },
  ];
}

/** Rescue & shelter codes go out with an adopter's paperwork. */
export function defaultRescueFormFields(): QrFormField[] {
  return [
    {
      key: "adoption_date",
      label: "When did you adopt?",
      type: "text",
      required: false,
      options: [],
      placeholder: "Month / year",
    },
    {
      key: "interest",
      label: "What are you most interested in?",
      type: "select",
      required: false,
      options: ["New adopter exam", "Dental cleaning", "Wellness exam", "Just saying hi"],
      placeholder: null,
    },
  ];
}

/** An influencer's code goes in their bio, stories and printed collateral. */
export function defaultInfluencerFormFields(): QrFormField[] {
  return [
    {
      key: "platform",
      label: "Where did you find us?",
      type: "select",
      required: false,
      options: ["Instagram", "TikTok", "YouTube", "Facebook", "In person", "Somewhere else"],
      placeholder: null,
    },
    {
      key: "interest",
      label: "What are you most interested in?",
      type: "select",
      required: false,
      options: ["Dental cleaning", "Wellness exam", "Grooming", "Just saying hi"],
      placeholder: null,
    },
    {
      key: "opt_in",
      label: "Email me Green Dog news & offers",
      type: "checkbox",
      required: false,
      options: [],
      placeholder: null,
    },
  ];
}

/** Promotion codes are printed on the flyer for the offer itself. */
export function defaultPromoFormFields(): QrFormField[] {
  return [
    {
      key: "opt_in",
      label: "Email me Green Dog news & offers",
      type: "checkbox",
      required: false,
      options: [],
      placeholder: null,
    },
  ];
}

/** Coerce an untrusted jsonb value into QrFormField[]. */
export function parseFormFields(raw: unknown): QrFormField[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(QR_FIELD_TYPES.map((t) => t.value));
  const out: QrFormField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!label) continue;
    const type = allowed.has(r.type as QrFieldType)
      ? (r.type as QrFieldType)
      : "text";
    out.push({
      key: typeof r.key === "string" && r.key ? r.key : slugifyFieldKey(label),
      label: label.slice(0, 160),
      type,
      required: r.required === true,
      options: Array.isArray(r.options)
        ? r.options.map((o) => String(o).slice(0, 80)).filter(Boolean).slice(0, 20)
        : [],
      placeholder:
        typeof r.placeholder === "string" && r.placeholder.trim()
          ? r.placeholder.trim().slice(0, 120)
          : null,
    });
    if (out.length >= 25) break;
  }
  return out;
}

const MAX_ANSWER_LENGTH = 500;

/**
 * Collect the answers to a form's custom questions from an untrusted public
 * submission. Only keys the form actually declares are read, select answers
 * must be one of the declared options, and every value is clamped.
 */
export function readFormAnswers(
  fields: QrFormField[],
  formData: FormData,
): { answers: Record<string, string> } | { error: string } {
  const answers: Record<string, string> = {};
  for (const f of fields) {
    const raw = formData.get(`custom_${f.key}`);
    let value =
      f.type === "checkbox"
        ? raw === "on" || raw === "true"
          ? "Yes"
          : "No"
        : raw == null
          ? ""
          : String(raw).trim();
    if (f.type === "select" && value && !f.options.includes(value)) {
      return { error: "Please choose one of the listed options." };
    }
    if (value.length > MAX_ANSWER_LENGTH) value = value.slice(0, MAX_ANSWER_LENGTH);
    if (f.required && (value === "" || (f.type === "checkbox" && value === "No"))) {
      return { error: `Please answer: ${f.label}` };
    }
    if (value !== "") answers[f.key] = value;
  }
  return { answers };
}
