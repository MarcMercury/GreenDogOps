export type OrgType =
  | "referral_clinic"
  | "marketing_partner"
  | "facility_resource"
  | "med_ops"
  | "office_marketing";

export type ContactType = "student" | "ce_attendee";

export interface CrmInfluencer {
  id: string;
  contact_name: string | null;
  pet_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  tier: string | null;
  priority: string | null;
  relationship_status: string | null;
  relationship_score: number | null;
  needs_followup: boolean | null;
  collaboration_type: string | null;
  content_niche: string | null;
  location: string | null;
  // Social
  instagram_handle: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  tiktok_handle: string | null;
  youtube_url: string | null;
  pet_instagram: string | null;
  highest_platform: string | null;
  follower_count: number | null;
  instagram_followers: number | null;
  tiktok_followers: number | null;
  youtube_subscribers: number | null;
  facebook_followers: number | null;
  engagement_rate: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  avg_views: number | null;
  // Audience
  audience_age_range: string | null;
  audience_gender_split: string | null;
  audience_location: string | null;
  // Agreement / compensation
  agreement_details: string | null;
  promo_code: string | null;
  ezyvet_tracking: string | null;
  compensation_type: string | null;
  compensation_rate: number | null;
  commission_percentage: number | null;
  total_paid: number | null;
  total_value_generated: number | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  // Performance
  total_campaigns: number | null;
  total_impressions: number | null;
  total_conversions: number | null;
  roi: number | null;
  posts_completed: number | null;
  stories_completed: number | null;
  reels_completed: number | null;
  events_attended: number | null;
  // Pet
  pet_breed: string | null;
  pet_type: string | null;
  pet_age: string | null;
  // Misc
  bio: string | null;
  notes: string | null;
  source: string | null;
  referral_source: string | null;
  last_post_date: string | null;
  last_contact_date: string | null;
  next_followup_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmOrganization {
  id: string;
  org_type: OrgType;
  name: string;
  subtype: string | null;
  category: string | null;
  status: string | null;
  contact_name: string | null;
  title: string | null;
  phone: string | null;
  phone_alt: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  area: string | null;
  clinic_area: string | null;
  services: string | null;
  products: string[] | null;
  tier: string | null;
  priority: string | null;
  membership_level: string | null;
  annual_fee: number | null;
  account_number: string | null;
  account_rep: string | null;
  total_referrals: number | null;
  revenue: number | null;
  monthly_spend: number | null;
  spend_ytd: number | null;
  relationship_score: number | null;
  internal_rating: number | null;
  confirmed_leads: number | null;
  confirmed_clients: number | null;
  is_preferred: boolean;
  is_active: boolean;
  // Agreement / partnership tracking (generic across vendors & partners)
  agreement_status: string | null;
  agreement_signed_date: string | null;
  tax_id: string | null;
  secondary_contact_name: string | null;
  secondary_contact_title: string | null;
  secondary_contact_email: string | null;
  secondary_contact_phone: string | null;
  last_visit_date: string | null;
  last_contact_date: string | null;
  last_referral_date: string | null;
  notes: string | null;
  source: string;
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

/** An uploaded document attached to a CRM organization record. */
export interface CrmOrgDocument {
  id: string;
  org_id: string;
  title: string;
  category: string | null;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
}

/** CrmOrgDocument with a short-lived signed URL for the private file. */
export interface CrmOrgDocumentWithUrl extends CrmOrgDocument {
  signed_url: string | null;
}

/** An uploaded document attached to a CRM contact record (e.g. a student). */
export interface CrmContactDocument {
  id: string;
  contact_id: string;
  title: string;
  category: string | null;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
}

/** CrmContactDocument with a short-lived signed URL for the private file. */
export interface CrmContactDocumentWithUrl extends CrmContactDocument {
  signed_url: string | null;
}

export interface CrmContact {
  id: string;
  contact_type: ContactType;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  organization: string | null;
  program_type: string | null;
  program_name: string | null;
  cohort: string | null;
  school: string | null;
  location: string | null;
  mentor: string | null;
  coordinator: string | null;
  visitor_type: string | null;
  supervising_dvm: string | null;
  weekday_schedule: string | null;
  doc_recommendation: string | null;
  degree_type: string | null;
  hire_interest: string | null;
  grad_year: string | null;
  stipend: string | null;
  completed: boolean | null;
  stipend_paid: boolean | null;
  check_cashed: boolean | null;
  start_date: string | null;
  end_date: string | null;
  hours_completed: number | null;
  hours_required: number | null;
  eligible_for_employment: boolean | null;
  opportunity_type: string | null;
  ce_events_attended: string | null;
  lead_source: string | null;
  notes: string | null;
  promoted_person_id: string | null;
  promoted_at: string | null;
  source: string;
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  referral_clinic: "Referral Clinics",
  marketing_partner: "Business Partners",
  facility_resource: "Facility Resources",
  med_ops: "Med Ops Vendors",
  office_marketing: "Marketing & Office",
};

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  student: "Students",
  ce_attendee: "CE Attendees",
};

// ---------------------------------------------------------------------------
// Dropdown option lists for CRM data-entry forms. Centralized so the same
// canonical choices appear across the Organization / Contact / Influencer
// forms. Values mirror what already exists in the database.
// ---------------------------------------------------------------------------
export interface CrmOption {
  value: string;
  label: string;
}

export const ORG_STATUS_OPTIONS: CrmOption[] = [
  { value: "active", label: "Active" },
  { value: "prospect", label: "Prospect" },
  { value: "lead", label: "Lead" },
  { value: "pending", label: "Pending" },
  { value: "inactive", label: "Inactive" },
];

export const CRM_TIER_OPTIONS: CrmOption[] = [
  { value: "Platinum", label: "Platinum" },
  { value: "Gold", label: "Gold" },
  { value: "Silver", label: "Silver" },
  { value: "Bronze", label: "Bronze" },
  { value: "Coal", label: "Coal" },
];

export const CRM_PRIORITY_OPTIONS: CrmOption[] = [
  { value: "Very High", label: "Very High" },
  { value: "High", label: "High" },
  { value: "Medium", label: "Medium" },
  { value: "Low", label: "Low" },
];

// Agreement / contract status for a vendor or partner record. Rescue partners
// sign a partnership agreement; vendors have MSAs / service contracts — the
// same lifecycle applies to both.
export const AGREEMENT_STATUS_OPTIONS: CrmOption[] = [
  { value: "none", label: "No agreement" },
  { value: "pending", label: "Approved — not sent" },
  { value: "sent", label: "Sent — awaiting signature" },
  { value: "signed", label: "Signed" },
  { value: "expired", label: "Expired" },
];

export const AGREEMENT_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  AGREEMENT_STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

/** Human-friendly label for a stored agreement_status value. */
export function agreementStatusLabel(value: string | null | undefined): string {
  if (!value) return "";
  return AGREEMENT_STATUS_LABELS[value] ?? value;
}

// Document categories for CRM record attachments (Attachments tab).
export const CRM_DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  agreement: "Partnership / Service Agreement",
  tax_501c3: "501(c)(3) / Tax (W-9, EIN)",
  insurance: "Insurance / Liability",
  correspondence: "Correspondence",
  invoice: "Invoice / Statement",
  other: "Other",
};

// Standard Business-CRM type taxonomy (value kept stable for data; label shown
// in the UI). Free text is still allowed in the form, but these are the
// canonical set every business record should map to.
export const BUSINESS_SUBTYPE_OPTIONS: CrmOption[] = [
  { value: "groomer", label: "Groomer" },
  { value: "daycare_boarding", label: "Daycare & Boarding" },
  { value: "pet_business", label: "Pet Services (Walk/Sit/Train)" },
  { value: "pet_retail", label: "Pet Retail & Supply" },
  { value: "food_vendor", label: "Food & Nutrition" },
  { value: "exotic_shop", label: "Exotic & Aquatic" },
  { value: "merch_vendor", label: "Merchandise Vendor" },
  { value: "rescue", label: "Rescue & Shelter" },
  { value: "chamber", label: "Association & Community" },
  { value: "media", label: "Media & Press" },
  { value: "entertainment", label: "Entertainment & Events" },
  { value: "print_vendor", label: "Printing, Signage & Design" },
  { value: "local_business", label: "Local Business Partner" },
  { value: "other", label: "Other" },
];

// The COMPLETE set of "Type" options for the Vendor & Partner CRM, built from the
// values already in use across every section (business, medical operations,
// office/marketing, and facility trades). This is the dropdown source for the
// record's Type field — values match what is stored so existing records map
// cleanly, while labels are tidied for display. ALL-CAPS legacy values keep
// their stored value but show a normalized label.
export const CRM_SUBTYPE_OPTIONS: CrmOption[] = [
  ...BUSINESS_SUBTYPE_OPTIONS.filter((o) => o.value !== "other"),
  // Medical operations
  { value: "Diagnostics & Reference Labs", label: "Diagnostics & Reference Labs" },
  { value: "Distributors", label: "Distributors" },
  { value: "Pharmacy & Compounding", label: "Pharmacy & Compounding" },
  { value: "PHARMACEUTICAL MANUFACTURERS", label: "Pharmaceutical Manufacturers" },
  { value: "MEDICAL SUPPLY DISTRIBUTORS", label: "Medical Supply Distributors" },
  { value: "SPECIALTY SUPPLIERS", label: "Specialty Suppliers" },
  { value: "Equipment & Hardware", label: "Equipment & Hardware" },
  { value: "Equipment Vendor", label: "Equipment Vendor" },
  { value: "Practice Management Software", label: "Practice Management Software" },
  { value: "Client Communication & Payment", label: "Client Communication & Payment" },
  { value: "ENDODONTICS", label: "Endodontics" },
  // Office / marketing
  { value: "RETAIL", label: "Retail" },
  { value: "PRINTING", label: "Printing" },
  { value: "Office Supply", label: "Office Supply" },
  { value: "Industry Media", label: "Industry Media" },
  { value: "Conference / CE", label: "Conference / CE" },
  { value: "VENDORS", label: "Vendors" },
  { value: "MISCELLANEOUS", label: "Miscellaneous" },
  // Facility & grounds
  { value: "handyman", label: "Handyman" },
  { value: "plumber", label: "Plumber" },
  { value: "hvac", label: "HVAC" },
  { value: "electrician", label: "Electrician" },
  { value: "gardener", label: "Gardener / Landscaping" },
  { value: "cabinetry", label: "Cabinetry" },
  { value: "locksmith", label: "Locksmith" },
  { value: "appliance_repair", label: "Appliance Repair" },
  { value: "audio", label: "Audio / AV" },
  { value: "Landlord", label: "Landlord" },
  { value: "Helpdesk", label: "Helpdesk / IT" },
  // Catch-all last
  { value: "other", label: "Other" },
];

export const SUBTYPE_LABELS: Record<string, string> = Object.fromEntries(
  CRM_SUBTYPE_OPTIONS.map((o) => [o.value, o.label]),
);

/** Human-friendly label for a stored subtype value (falls back to the raw value). */
export function subtypeLabel(value: string | null | undefined): string {
  if (!value) return "";
  return SUBTYPE_LABELS[value] ?? value;
}

// Suggestions only (free text still allowed) — canonical business taxonomy.
export const ORG_SUBTYPE_SUGGESTIONS: CrmOption[] = BUSINESS_SUBTYPE_OPTIONS;

// High-level Vendor & Partner CRM category. Every vendor/partner record has one
// category plus a free-text subtype ("Type"). Referral clinics have no category.
export const CATEGORY_OPTIONS: CrmOption[] = [
  { value: "medical_equip", label: "Medical Equipment" },
  { value: "medical_supplies", label: "Medical Supplies" },
  { value: "facility_supply", label: "Facility Supply" },
  { value: "facility_maintenance", label: "Facility Maintenance" },
  { value: "marketing", label: "Marketing" },
];

export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
);

/** Human-friendly label for a stored category value (falls back to the raw value). */
export function categoryLabel(value: string | null | undefined): string {
  if (!value) return "";
  return CATEGORY_LABELS[value] ?? value;
}

export const CONTACT_STATUS_OPTIONS: CrmOption[] = [
  { value: "lead", label: "Lead" },
  { value: "registrant", label: "Registrant" },
  { value: "upcoming", label: "Upcoming" },
  { value: "current", label: "Current" },
  { value: "enrolled", label: "Enrolled" },
  { value: "in_progress", label: "In Progress" },
  { value: "attendee", label: "Attendee" },
  { value: "completed", label: "Completed" },
  { value: "done", label: "Done" },
  { value: "no_show", label: "No Show" },
  { value: "applied", label: "Applied" },
];

export const VISITOR_TYPE_OPTIONS: CrmOption[] = [
  { value: "student", label: "Student" },
  { value: "extern", label: "Extern" },
  { value: "intern", label: "Intern" },
  { value: "ce_attendee", label: "CE Attendee" },
  { value: "other", label: "Other" },
];

export const HIRE_INTEREST_OPTIONS: CrmOption[] = [
  { value: "want_to_hire", label: "Want to Hire" },
  { value: "maybe", label: "Maybe / Watch" },
  { value: "not_interested", label: "Not Interested" },
];

// Veterinary degree track for a student contact. DVM/VMD are the entry doctoral
// degrees; the remaining entries are the recognized specialty-board diplomate
// designations (an "abbreviation (specialty)" pattern). Free text from legacy
// data is preserved by the Select's "(current)" fallback.
export const DEGREE_TYPE_OPTIONS: CrmOption[] = [
  { value: "DVM", label: "DVM — Doctor of Veterinary Medicine" },
  { value: "VMD", label: "VMD — Veterinariae Medicinae Doctor" },
  { value: "DACVIM", label: "DACVIM — Internal Medicine (SAIM)" },
  { value: "DACVIM (Cardiology)", label: "DACVIM — Cardiology" },
  { value: "DACVIM (Neurology)", label: "DACVIM — Neurology" },
  { value: "DACVIM (Oncology)", label: "DACVIM — Oncology" },
  { value: "DACVIM (LAIM)", label: "DACVIM — Large Animal Internal Medicine" },
  { value: "DACVS", label: "DACVS — Surgery" },
  { value: "DACVS-SA", label: "DACVS-SA — Surgery (Small Animal)" },
  { value: "DACVS-LA", label: "DACVS-LA — Surgery (Large Animal)" },
  { value: "DACVECC", label: "DACVECC — Emergency & Critical Care" },
  { value: "DACVAA", label: "DACVAA — Anesthesia & Analgesia" },
  { value: "DACVD", label: "DACVD — Dermatology" },
  { value: "DACVO", label: "DACVO — Ophthalmology" },
  { value: "DACVR", label: "DACVR — Radiology" },
  { value: "DACVR-RO", label: "DACVR-RO — Radiation Oncology" },
  { value: "DACVP", label: "DACVP — Pathology" },
  { value: "DABVP", label: "DABVP — Board of Veterinary Practitioners" },
  { value: "DACVN", label: "DACVN — Nutrition" },
  { value: "DACVB", label: "DACVB — Behavior" },
  { value: "DACT", label: "DACT — Theriogenology (Reproduction)" },
  { value: "DAVDC", label: "DAVDC — Dentistry" },
  { value: "DACVSMR", label: "DACVSMR — Sports Medicine & Rehabilitation" },
  { value: "DACVPM", label: "DACVPM — Preventive Medicine" },
  { value: "DACZM", label: "DACZM — Zoological Medicine" },
  { value: "DACLAM", label: "DACLAM — Laboratory Animal Medicine" },
  { value: "DACVM", label: "DACVM — Microbiology" },
  { value: "DACPV", label: "DACPV — Poultry Veterinarians" },
];

// Color-coded recommendation level for a student (formerly "Doc recommendation").
// Green = strong, Yellow = neutral / watch, Red = do not recommend.
export type RecommendationLevel = "green" | "yellow" | "red";

export const RECOMMENDATION_LEVEL_OPTIONS: CrmOption[] = [
  { value: "green", label: "Green" },
  { value: "yellow", label: "Yellow" },
  { value: "red", label: "Red" },
];

/** Tailwind classes for a recommendation-level swatch/select background. */
export const RECOMMENDATION_LEVEL_STYLES: Record<
  RecommendationLevel,
  { swatch: string; select: string }
> = {
  green: { swatch: "bg-emerald-500", select: "bg-emerald-50 text-emerald-800 border-emerald-300" },
  yellow: { swatch: "bg-amber-400", select: "bg-amber-50 text-amber-800 border-amber-300" },
  red: { swatch: "bg-red-500", select: "bg-red-50 text-red-800 border-red-300" },
};

export const PROGRAM_TYPE_SUGGESTIONS: string[] = [
  "externship",
  "internship",
  "paid_cohort",
  "intensive",
  "shadowing",
  "rotation",
];

export const INFLUENCER_STATUS_OPTIONS: CrmOption[] = [
  { value: "active", label: "Active" },
  { value: "prospect", label: "Prospect" },
  { value: "inactive", label: "Inactive" },
  { value: "completed", label: "Completed" },
];

export const INFLUENCER_TIER_OPTIONS: CrmOption[] = [
  { value: "nano", label: "Nano (< 10K)" },
  { value: "micro", label: "Micro (10K–100K)" },
  { value: "macro", label: "Macro (100K–1M)" },
  { value: "mega", label: "Mega (1M+)" },
];

export const INFLUENCER_PRIORITY_OPTIONS: CrmOption[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const INFLUENCER_RELATIONSHIP_STATUS_OPTIONS: CrmOption[] = [
  { value: "new", label: "New" },
  { value: "active", label: "Active" },
  { value: "past_partner", label: "Past Partner" },
  { value: "declined", label: "Declined" },
];

export const PLATFORM_OPTIONS: CrmOption[] = [
  { value: "Instagram", label: "Instagram" },
  { value: "TikTok", label: "TikTok" },
  { value: "YouTube", label: "YouTube" },
  { value: "Facebook", label: "Facebook" },
];

export const COLLABORATION_TYPE_OPTIONS: CrmOption[] = [
  { value: "sponsored_post", label: "Sponsored Post" },
  { value: "ambassador", label: "Brand Ambassador" },
  { value: "affiliate", label: "Affiliate" },
  { value: "gifting", label: "Product Gifting" },
  { value: "event", label: "Event Appearance" },
  { value: "ugc", label: "UGC / Content" },
];

export const COMPENSATION_TYPE_OPTIONS: CrmOption[] = [
  { value: "paid", label: "Paid" },
  { value: "commission", label: "Commission" },
  { value: "gifting", label: "Product / Gifting" },
  { value: "hybrid", label: "Hybrid (Paid + Commission)" },
  { value: "none", label: "None" },
];

// ---------------------------------------------------------------------------
// CRM sections — the CRM module is split into focused sub-CRMs.
//   referral : referring medical clinics
//   vendor   : facility resources + med-ops vendors
//   business : business / marketing partners
//   student  : students & program participants (contacts)
//   ce       : continuing-education leads / attendees (contacts)
// (Recruiting/ATS lives in its own module at /ats.)
// ---------------------------------------------------------------------------
export type CrmSlug =
  | "referral"
  | "vendor"
  | "student"
  | "ce"
  | "influencer";

export interface CrmSection {
  slug: CrmSlug;
  title: string;
  label: string;
  description: string;
  icon: string;
  entity: "organization" | "contact" | "influencer";
  orgTypes?: OrgType[];
  contactTypes?: ContactType[];
}

export const CRM_SECTIONS: CrmSection[] = [
  {
    slug: "referral",
    title: "Referral CRM",
    label: "Referral CRM",
    description: "Referring medical clinics & hospitals.",
    icon: "🏥",
    entity: "organization",
    orgTypes: ["referral_clinic"],
  },
  {
    slug: "vendor",
    title: "Vendor & Partner CRM",
    label: "Vendor & Partner CRM",
    description: "Vendors, suppliers & business partners in one directory.",
    icon: "🤝",
    entity: "organization",
    orgTypes: [
      "marketing_partner",
      "facility_resource",
      "med_ops",
      "office_marketing",
    ],
  },
  {
    slug: "student",
    title: "Student CRM",
    label: "Student CRM",
    description: "Students, externs, and program participants.",
    icon: "🎓",
    entity: "contact",
    contactTypes: ["student"],
  },
  {
    slug: "ce",
    title: "CE Leads/Events",
    label: "CE Leads/Events",
    description: "Continuing-education events, submissions, attendees & leads.",
    icon: "📋",
    entity: "contact",
    contactTypes: ["ce_attendee"],
  },
  {
    slug: "influencer",
    title: "Influencer CRM",
    label: "Influencer CRM",
    description: "Influencer partnerships, campaigns & performance.",
    icon: "⭐",
    entity: "influencer",
  },
];

export function crmSectionBySlug(slug: string): CrmSection | undefined {
  return CRM_SECTIONS.find((s) => s.slug === slug);
}

export function crmSlugForOrgType(t: OrgType): CrmSlug {
  return (
    CRM_SECTIONS.find((s) => s.orgTypes?.includes(t))?.slug ?? "vendor"
  );
}

export function crmSlugForContactType(t: ContactType): CrmSlug {
  return (
    CRM_SECTIONS.find((s) => s.contactTypes?.includes(t))?.slug ?? "student"
  );
}

// ---------------------------------------------------------------------------
// CE attendance — per-attendee log of the continuing-education events a CE lead
// is attending, with their preparation + payment status for each event.
// ---------------------------------------------------------------------------
export interface CrmCeAttendance {
  id: string;
  contact_id: string;
  ce_event_id: string | null;
  ce_name: string;
  ce_date: string | null;
  confirmed_date: string | null;
  paid: boolean;
  showed_up: boolean;
  materials_prepared: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// CE event — a first-class continuing-education event with its own scheduling
// and logistics details. CE leads are rostered against it via crm_ce_attendance.
// ---------------------------------------------------------------------------
export interface CrmCeEvent {
  id: string;
  name: string;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  subject: string | null;
  presenters: string | null;
  description: string | null;
  cost_type: string;
  cost_amount: number | null;
  audience: string | null;
  status: string;
  capacity: number | null;
  registration_url: string | null;
  notes: string | null;
  // CEbroker course record
  course_type: string | null;
  delivery_method: string | null;
  tracking_number: string | null;
  learning_objectives: string | null;
  disclosure_statements: string | null;
  // RACE / AAVSB approval
  approval_board: string | null;
  approval_status: string | null;
  race_approved: boolean;
  ce_hours_total: number | null;
  ce_hours_medical: number | null;
  ce_hours_nonmedical: number | null;
  effective_start: string | null;
  effective_end: string | null;
  projected_offering_date: string | null;
  rosters_allowed_date: string | null;
  // Presenter & marketing
  presenter_bio: string | null;
  website_url: string | null;
  // Event logistics
  whats_included: string | null;
  who_should_attend: string | null;
  social_dinner: boolean;
  // Per-event planning checklist ({ item_key: boolean })
  planning_checklist: Record<string, boolean>;
  // Editable run-of-show itinerary (list of timed lines)
  itinerary: CeItineraryLine[];
  created_at: string;
  updated_at: string;
}

// A single line in a CE event's editable itinerary. `day` is an ISO date
// (YYYY-MM-DD), `time` is 24h HH:MM.
export interface CeItineraryLine {
  id: string;
  day: string;
  time: string;
  description: string;
}

export const CE_COST_TYPE_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
] as const;

export const CE_AUDIENCE_OPTIONS = [
  { value: "dvm", label: "DVM / Veterinarian" },
  { value: "tech", label: "Technician" },
  { value: "assistant", label: "Assistant" },
  { value: "manager", label: "Practice Manager" },
  { value: "csr", label: "Client Service Rep" },
  { value: "student", label: "Student" },
  { value: "anyone", label: "Anyone / All Staff" },
] as const;

export const CE_STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

// CEbroker course type (providers.cebroker.com → Course Type).
export const CE_COURSE_TYPE_OPTIONS = [
  { value: "live", label: "Live Course" },
  { value: "online_interactive", label: "RACE Online — Interactive" },
  { value: "online_noninteractive", label: "RACE Online — Non-interactive" },
  { value: "recorded", label: "Recorded / On-demand" },
] as const;

// CEbroker delivery method (providers.cebroker.com → Delivery Method).
export const CE_DELIVERY_METHOD_OPTIONS = [
  { value: "seminar_lecture", label: "Seminar/Lecture" },
  { value: "lab_wetlab", label: "Lab/Wet Lab" },
  { value: "seminar_and_lab", label: "Seminar/Lecture & Lab/Wet Lab" },
  { value: "online", label: "Online" },
  { value: "hybrid", label: "Hybrid" },
] as const;

// Where the course sits in the CEbroker / RACE approval pipeline.
export const CE_APPROVAL_STATUS_OPTIONS = [
  { value: "not_submitted", label: "Not submitted" },
  { value: "pending", label: "Pending review" },
  { value: "submitted", label: "Submitted" },
  { value: "registered", label: "Registered" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
] as const;

// Common approving boards (free text allowed via ComboField).
export const CE_APPROVAL_BOARD_SUGGESTIONS = [
  "American Association of Veterinary State Boards (AAVSB / RACE)",
  "California Veterinary Medical Board",
  "Alabama State Board of Veterinary Medical Examiners",
] as const;

// Per-event planning/resources checklist. Item keys are stable and stored in
// crm_ce_event.planning_checklist ({ key: boolean }); labels come from the GDD
// CE setup/registration workflow. Rendered read-only in the New/Edit wizard and
// interactively in the CE Events management tab.
export const CE_PLANNING_CHECKLIST: {
  group: string;
  items: { key: string; label: string }[];
}[] = [
  {
    group: "Marketing & promotion",
    items: [
      { key: "flyer", label: "Create flyer, email & promo sheet" },
      {
        key: "invite_clinics",
        label: "Invite local clinics (email, visits, texts)",
      },
      {
        key: "track_responses",
        label: "Track responses in Master Referral Sheet",
      },
      { key: "program", label: "Build branded event program / itinerary" },
    ],
  },
  {
    group: "Venue & AV setup",
    items: [
      { key: "venue", label: "Confirm venue & room setup" },
      {
        key: "av",
        label: "AV equipment ready (display, mic, clicker, adapters)",
      },
      { key: "handouts", label: "Lecture handouts / printed notes in binders" },
      { key: "goody_bags", label: "GDD-branded goody bags" },
    ],
  },
  {
    group: "Lab & supplies",
    items: [
      {
        key: "equipment",
        label: "Confirm equipment per student (tables, instruments)",
      },
      {
        key: "consumables",
        label: "Order consumables & supplies ahead of deadline",
      },
      {
        key: "presenter_prefs",
        label: "Confirm presenter preferences / special requests",
      },
    ],
  },
  {
    group: "Food, filming & final",
    items: [
      { key: "food", label: "Food & refreshments ordered" },
      { key: "filming", label: "Photographer/videographer scheduled both days" },
      { key: "testimonials", label: "Collect ≥3 DVM testimonials" },
      { key: "social_dinner_rsvp", label: "RSVP for social dinner" },
    ],
  },
];

export const CE_SUBJECT_SUGGESTIONS = [
  "Dentistry",
  "Ultrasound / Imaging",
  "Surgery",
  "Internal Medicine",
  "Emergency & Critical Care",
  "Cardiology",
  "Dermatology",
  "Anesthesia",
  "Nutrition",
  "Behavior",
  "Practice Management",
  "Client Communication",
] as const;
