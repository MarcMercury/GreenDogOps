// =====================================================
// Referral CRM (Medical Partnerships) — shared types, constants & helpers
// Ported from EmployeeGMGDD app/utils/marketingConstants.ts +
// app/types/marketing.types.ts so the GDO module mirrors it exactly.
// =====================================================

export interface ReferralPartner {
  id: string;
  name: string | null;
  hospital_name: string | null;
  status: string | null;
  is_active: boolean | null;

  // Contact
  contact_name: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  instagram_handle: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;

  // Classification
  tier: string | null;
  priority: string | null;
  zone: string | null;
  clinic_type: string | null;
  size: string | null;
  organization_type: string | null;
  employee_count: string | null;
  category: string | null;
  services: string[] | null;
  specialty_areas: string[] | null;

  // Visit targeting
  visit_frequency: string | null;
  expected_visit_frequency_days: number | null;
  preferred_visit_day: string | null;
  preferred_visit_time: string | null;
  best_contact_person: string | null;
  needs_followup: boolean | null;
  followup_reason: string | null;
  next_followup_date: string | null;

  // Dates
  last_visit_date: string | null;
  last_referral_date: string | null;
  last_contact_date: string | null;
  last_sync_date: string | null;

  // Referral stats
  total_referrals_all_time: number | null;
  total_referrals_ytd: number | null;
  total_referrals: number | null;
  total_revenue_all_time: number | null;
  revenue_ytd: number | null;
  revenue_last_year: number | null;
  average_monthly_revenue: number | null;
  referrals_last_12_months: number | null;
  referral_divisions: string[] | null;

  // Derived metrics
  visit_tier: string | null;
  days_since_last_visit: number | null;
  visit_overdue: boolean | null;
  relationship_health: number | null;
  relationship_status: string | null;
  relationship_score: number | null;

  // Agreements
  referral_agreement_type: string | null;
  ce_event_host: boolean | null;
  lunch_and_learn_eligible: boolean | null;
  drop_off_materials: boolean | null;

  // Goals
  monthly_referral_goal: number | null;
  quarterly_revenue_goal: number | null;
  current_month_referrals: number | null;
  current_quarter_revenue: number | null;

  // Misc
  notes: string | null;
  description: string | null;
  tags: string[] | null;

  // Geocoding (Map View)
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  geocoded_address: string | null;

  created_at: string;
  updated_at: string | null;
}

export interface ClinicVisit {
  id: string;
  created_at: string;
  partner_id: string | null;
  clinic_name: string;
  visit_date: string;
  spoke_to: string | null;
  items_discussed: string[] | null;
  next_visit_date: string | null;
  visit_notes: string | null;
}

/**
 * A single entry from the shared audit_log, scoped to Referral CRM actions
 * (action starts with "referral."). Powers the Activity tab's "All Activity"
 * feed so every user mutation — partner edits, contact/note changes, uploads —
 * is visible, not just logged clinic visits.
 */
export interface ActivityLogEntry {
  id: string;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  summary: string | null;
  created_at: string;
}

/** Human-readable label for a referral.* audit action. */
export function activityActionLabel(action: string): string {
  const map: Record<string, string> = {
    "referral.partner.create": "Created partner",
    "referral.partner.update": "Updated partner",
    "referral.partner.delete": "Deleted partner",
    "referral.partner.quickadd": "Quick-added partner",
    "referral.unmatched.dismiss": "Dismissed unmatched clinic",
    "referral.contact.create": "Added contact",
    "referral.contact.update": "Updated contact",
    "referral.contact.delete": "Deleted contact",
    "referral.note.create": "Added note",
    "referral.note.update": "Updated note",
    "referral.note.delete": "Deleted note",
    "referral.visit.log": "Logged visit",
    "referral.metrics.recalculate": "Recalculated metrics",
    "referral.stats.clear": "Cleared referral stats",
    "referral.upload": "Uploaded referral data",
    "referral.upload.undo": "Undid an upload",
  };
  return map[action] ?? titleCase(action.replace(/^referral\./, "").replace(/[._]/g, " "));
}

export interface PartnerContact {
  id: string;
  partner_id: string | null;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean | null;
  relationship_notes: string | null;
  preferred_contact_method: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface PartnerNote {
  id: string;
  partner_id: string | null;
  note_type: string | null;
  category: string | null;
  content: string;
  is_pinned: boolean | null;
  created_by: string | null;
  created_by_name: string | null;
  author_initials: string | null;
  created_at: string;
  updated_at: string | null;
}

export const NOTE_CATEGORY_OPTIONS = [
  "general",
  "meeting",
  "call",
  "email",
  "visit",
  "follow_up",
  "agreement",
  "issue",
] as const;

export const CONTACT_METHOD_OPTIONS = ["email", "phone", "text", "in_person"] as const;

export interface SyncHistoryRow {
  id: string;
  filename: string;
  upload_date: string;
  date_range_start: string | null;
  date_range_end: string | null;
  total_rows_parsed: number | null;
  total_rows_matched: number | null;
  total_rows_skipped: number | null;
  total_revenue_added: number | null;
  report_type: string | null;
  sync_details: Record<string, unknown> | null;
}

export interface UnmatchedEntry {
  clinicName: string;
  visits: number;
  revenue: number;
  uploadDate: string;
  dateRange: string;
}

// ---------------------------------------------------------------------------
// Geographic zones (shared between Partners & Targeting)
// ---------------------------------------------------------------------------
export const ZONE_DEFINITIONS = [
  { value: "Westside & Coastal", title: "Westside & Coastal 🌊", description: "Santa Monica, Venice, Marina del Rey, Culver City, Beverly Hills, Westwood, Malibu, Pacific Palisades, Brentwood" },
  { value: "South Valley", title: "South Valley 🎬", description: "Studio City, Sherman Oaks, Encino, Tarzana, Woodland Hills, Burbank, Toluca Lake, Universal City" },
  { value: "North Valley", title: "North Valley 🏘️", description: "Northridge, Chatsworth, Granada Hills, Porter Ranch, Van Nuys, Reseda, Canoga Park, North Hollywood, Sun Valley, Sylmar" },
  { value: "Central & Eastside", title: "Central & Eastside 🏙️", description: "DTLA, Silver Lake, Echo Park, Hollywood, West Hollywood, Los Feliz, Eagle Rock, Boyle Heights" },
  { value: "South Bay", title: "South Bay & Airport ✈️", description: "El Segundo, Manhattan Beach, Torrance, Redondo Beach, Hawthorne, Inglewood, Gardena" },
  { value: "San Gabriel Valley", title: "San Gabriel Valley 🥡", description: "Pasadena, Glendale, Arcadia, Alhambra, Monterey Park, San Marino" },
] as const;

export function getZoneDisplay(zone: string | null | undefined): string {
  if (!zone) return "—";
  const def = ZONE_DEFINITIONS.find((z) => z.value === zone);
  return def ? def.title : zone;
}

// ---------------------------------------------------------------------------
// Referral partnership constants (partnerships.vue)
// ---------------------------------------------------------------------------
export const REFERRAL_TIERS = ["Platinum", "Gold", "Silver", "Bronze", "Coal"] as const;
export const REFERRAL_PRIORITIES = ["Very High", "High", "Medium", "Low"] as const;

export const CLINIC_TYPE_OPTIONS = ["general", "specialty", "emergency", "urgent_care", "mobile", "shelter", "corporate", "independent"] as const;
export const CLINIC_SIZE_OPTIONS = ["small", "medium", "large", "enterprise"] as const;
export const ORGANIZATION_TYPE_OPTIONS = ["independent", "corporate", "franchise", "nonprofit", "university", "government"] as const;

export const VET_SERVICE_OPTIONS = [
  "Dentistry", "GP", "Urg Care", "Emergency", "24Hr Care",
  "Internal Med", "Cardio", "Exotics", "CT/Imaging", "Derm",
  "Optho", "Accup", "Other",
] as const;

export const VISIT_FREQUENCY_OPTIONS = ["weekly", "biweekly", "monthly", "quarterly", "annually", "as_needed"] as const;
export const PREFERRED_DAY_OPTIONS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
export const PREFERRED_TIME_OPTIONS = ["morning", "midday", "afternoon"] as const;
export const AGREEMENT_TYPE_OPTIONS = ["none", "informal", "formal", "exclusive"] as const;
export const STATUS_OPTIONS = ["active", "inactive", "prospect"] as const;

// Items discussed on a quick visit (mirrors PartnershipQuickVisitDialog)
export const VISIT_ITEM_OPTIONS = [
  { value: "surgery", label: "Surgery" },
  { value: "dental_surgery", label: "Dental Surgery" },
  { value: "im", label: "Internal Medicine" },
  { value: "exotics", label: "Exotics" },
  { value: "urgent_care", label: "Urgent Care" },
  { value: "ce", label: "CE" },
  { value: "gdd_event", label: "GDD Event" },
  { value: "other", label: "Other" },
] as const;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
export function partnerName(p: ReferralPartner): string {
  return p.name || p.hospital_name || "Unnamed Partner";
}

export function formatCurrency(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatCompactCurrency(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return "Never";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "Never";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function tierClass(tier: string | null | undefined): string {
  switch (tier) {
    case "Platinum": return "bg-slate-200 text-slate-800 ring-slate-300";
    case "Gold": return "bg-amber-100 text-amber-800 ring-amber-200";
    case "Silver": return "bg-zinc-100 text-zinc-700 ring-zinc-200";
    case "Bronze": return "bg-orange-100 text-orange-800 ring-orange-200";
    case "Coal": return "bg-neutral-200 text-neutral-700 ring-neutral-300";
    default: return "bg-slate-100 text-slate-600 ring-slate-200";
  }
}

export function priorityClass(priority: string | null | undefined): string {
  switch (priority) {
    case "Very High": return "bg-red-100 text-red-700 ring-red-200";
    case "High": return "bg-orange-100 text-orange-700 ring-orange-200";
    case "Medium": return "bg-amber-100 text-amber-700 ring-amber-200";
    case "Low": return "bg-slate-100 text-slate-600 ring-slate-200";
    default: return "bg-slate-100 text-slate-600 ring-slate-200";
  }
}

export function healthColor(health: number | null | undefined): string {
  const h = Number(health) || 0;
  if (h >= 80) return "bg-emerald-500";
  if (h >= 60) return "bg-green-500";
  if (h >= 40) return "bg-amber-500";
  if (h >= 20) return "bg-orange-500";
  return "bg-red-500";
}

export function statusClass(status: string | null | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "active": return "bg-emerald-100 text-emerald-700 ring-emerald-200";
    case "prospect": return "bg-sky-100 text-sky-700 ring-sky-200";
    case "inactive": return "bg-slate-100 text-slate-500 ring-slate-200";
    default: return "bg-slate-100 text-slate-600 ring-slate-200";
  }
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
