/**
 * QR codes & their public capture forms.
 *
 * A QR code encodes `/q/<token>` — an opaque 16-char hex handle, never a row
 * id, so the public URL cannot be used to enumerate the database. Scanning it
 * renders the linked form (or redirects to `target_url`); submissions land in
 * greendogops.qr_lead.
 */

export type QrCodeType = "event" | "ce" | "promo" | "partner" | "other";

export const QR_CODE_TYPES: { value: QrCodeType; label: string; icon: string }[] = [
  { value: "event", label: "Event", icon: "🎪" },
  { value: "ce", label: "CE course", icon: "📋" },
  { value: "promo", label: "Promotion", icon: "🏷️" },
  { value: "partner", label: "Retail partner", icon: "🤝" },
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
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface QrCode {
  id: string;
  token: string;
  label: string;
  code_type: string;
  event_id: string | null;
  ce_event_id: string | null;
  promotion_id: string | null;
  org_id: string | null;
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

/** Public scan URL for a QR code token. */
export function qrScanUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/q/${token}`;
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
