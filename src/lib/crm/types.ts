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
  is_preferred: boolean;
  is_active: boolean;
  last_visit_date: string | null;
  last_contact_date: string | null;
  last_referral_date: string | null;
  notes: string | null;
  source: string;
  external_id: string | null;
  created_at: string;
  updated_at: string;
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

// Suggestions only (free text still allowed) — subtype varies widely by org type.
export const ORG_SUBTYPE_SUGGESTIONS: string[] = [
  "general",
  "specialty",
  "emergency",
  "groomer",
  "daycare_boarding",
  "rescue",
  "pet_retail",
  "pet_business",
  "food_vendor",
  "merch_vendor",
  "print_vendor",
  "local_business",
  "chamber",
  "media",
  "entertainment",
  "other",
];

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
  | "business"
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
    title: "Vendor CRM",
    label: "Vendor CRM",
    description: "Med-ops, facility, and marketing/office vendors.",
    icon: "🔧",
    entity: "organization",
    orgTypes: ["facility_resource", "med_ops", "office_marketing"],
  },
  {
    slug: "business",
    title: "Business CRM",
    label: "Business CRM",
    description: "Business & marketing partners.",
    icon: "🤝",
    entity: "organization",
    orgTypes: ["marketing_partner"],
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
    title: "CE Leads",
    label: "CE Leads",
    description: "Continuing-education event attendees & leads.",
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
    CRM_SECTIONS.find((s) => s.orgTypes?.includes(t))?.slug ?? "business"
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
