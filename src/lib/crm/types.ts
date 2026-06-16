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
