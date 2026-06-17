// Credential vault types & labels (Admin module).

export interface Credential {
  id: string;
  category: string;
  label: string;
  service: string | null;
  url: string | null;
  username: string | null;
  password: string | null;
  account_number: string | null;
  location: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  order_method: string | null;
  payment_method: string | null;
  status: string | null;
  owner_scope: string | null;
  notes: string | null;
  org_id: string | null;
  source: string;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
}

export const CREDENTIAL_CATEGORIES = [
  "vendor",
  "lab",
  "internal_email",
  "phone_system",
  "ezyvet",
  "wifi",
  "banking",
  "software",
  "retail",
  "technical",
  "legacy",
  "other",
] as const;

export type CredentialCategory = (typeof CREDENTIAL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<string, string> = {
  vendor: "Vendors",
  lab: "Labs",
  internal_email: "Internal Email",
  phone_system: "Phone System",
  ezyvet: "EzyVet Users",
  wifi: "Wi-Fi",
  banking: "Banking",
  software: "Software / SaaS",
  retail: "Retail",
  technical: "Technical / Equipment",
  legacy: "Historic / Legacy",
  other: "Other",
};

export const CATEGORY_ICONS: Record<string, string> = {
  vendor: "📦",
  lab: "🧪",
  internal_email: "✉️",
  phone_system: "☎️",
  ezyvet: "🐾",
  wifi: "📶",
  banking: "🏦",
  software: "💻",
  retail: "🛒",
  technical: "🔧",
  legacy: "🗄️",
  other: "🔑",
};

export function categoryLabel(c: string): string {
  return CATEGORY_LABELS[c] ?? c;
}
