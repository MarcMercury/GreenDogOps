export type OrgType =
  | "referral_clinic"
  | "marketing_partner"
  | "facility_resource"
  | "med_ops";

export type ContactType = "student" | "ce_attendee";

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
export type CrmSlug = "referral" | "vendor" | "business" | "student" | "ce";

export interface CrmSection {
  slug: CrmSlug;
  title: string;
  label: string;
  description: string;
  icon: string;
  entity: "organization" | "contact";
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
