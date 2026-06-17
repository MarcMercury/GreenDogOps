export type OrgType =
  | "referral_clinic"
  | "marketing_partner"
  | "facility_resource"
  | "med_ops";

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
  start_date: string | null;
  end_date: string | null;
  hours_completed: number | null;
  hours_required: number | null;
  eligible_for_employment: boolean | null;
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
};

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  student: "Students",
  ce_attendee: "CE Attendees",
};

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
    description: "Facility resources and medical-ops vendors.",
    icon: "🔧",
    entity: "organization",
    orgTypes: ["facility_resource", "med_ops"],
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
