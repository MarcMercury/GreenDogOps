export type EmploymentStatus =
  | "prospect"
  | "applicant"
  | "employee"
  | "former"
  | "contractor";

export type WorkLocationType = "in_house" | "remote" | "hybrid";
export type FlsaStatus = "exempt" | "non_exempt";
export type WorkSchedule = "full_time" | "part_time" | "per_diem" | "contractor";
export type SeparationType = "quit" | "fired" | "laid_off" | "other";

export interface Person {
  id: string;
  status: EmploymentStatus;
  status_changed_at: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  grid_name: string | null;
  full_name: string | null;
  email: string | null;
  phone_mobile: string | null;
  phone_home: string | null;
  phone_other: string | null;
  date_of_birth: string | null;
  postal_code: string | null;
  work_location_type: WorkLocationType | null;
  opportunity_type: string | null;
  avatar_url: string | null;
  is_active: boolean;
  notes: string | null;
  source_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonEmployment {
  person_id: string;
  position_id: string | null;
  location_id: string | null;
  offer_title: string | null;
  adp_job_title: string | null;
  flsa_status: FlsaStatus | null;
  work_schedule: WorkSchedule | null;
  days_per_week: number | null;
  hire_date: string | null;
  original_hire_date: string | null;
  pay_type: string | null;
  current_rate: number | null;
  previous_rate: number | null;
  latest_wage_change_date: string | null;
  biweekly_wage: number | null;
  annual_wages: number | null;
  pto_allotment: string | null;
  pto_policy_allotment: number | null;
  pto_used: number | null;
  pto_available: number | null;
  pto_notes: string | null;
  ce_budget: number | null;
  ce_used: number | null;
  ce_remaining: number | null;
  benefits_enrolled: boolean | null;
  benefits_monthly: number | null;
  benefits_annual: number | null;
  last_review_date: string | null;
  compliance: Record<string, string | null>;
  separation_date: string | null;
  separation_type: SeparationType | null;
  separation_letter_signed: boolean | null;
  separation_notes: string | null;
}

export interface RosterRow extends Person {
  person_employment: PersonEmployment | null;
}

/** Employment fields treated as compensation/benefits — admin-only. */
export const COMPENSATION_FIELDS: Array<keyof PersonEmployment> = [
  "pay_type",
  "current_rate",
  "previous_rate",
  "latest_wage_change_date",
  "biweekly_wage",
  "annual_wages",
  "benefits_enrolled",
  "benefits_monthly",
  "benefits_annual",
  "ce_budget",
  "ce_used",
  "ce_remaining",
  "last_review_date",
];

/** Return a copy of the row with compensation fields nulled out. */
export function redactCompensation(row: RosterRow): RosterRow {
  if (!row.person_employment) return row;
  const emp = { ...row.person_employment } as Record<string, unknown>;
  for (const field of COMPENSATION_FIELDS) emp[field] = null;
  return { ...row, person_employment: emp as unknown as PersonEmployment };
}

export interface PersonReview {
  id: string;
  person_id: string;
  review_date: string | null;
  review_type: string | null;
  reviewer: string | null;
  rating: string | null;
  summary: string | null;
  next_review_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonPtoDay {
  id: string;
  person_id: string;
  pto_date: string;
  hours: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export type TimeOffKind = "pto" | "vacation" | "time_off";
export type TimeOffStatus = "requested" | "approved" | "denied";

export interface PersonTimeOff {
  id: string;
  person_id: string;
  kind: TimeOffKind;
  status: TimeOffStatus;
  start_date: string;
  end_date: string;
  note: string | null;
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const TIME_OFF_KIND_LABELS: Record<TimeOffKind, string> = {
  pto: "PTO",
  vacation: "Vacation",
  time_off: "Time Off",
};

export const TIME_OFF_STATUS_LABELS: Record<TimeOffStatus, string> = {
  requested: "Pending",
  approved: "Approved",
  denied: "Denied",
};

/** Tone for the HR profile chips. */
export const TIME_OFF_STATUS_TONE: Record<TimeOffStatus, string> = {
  requested: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-700",
  denied: "bg-slate-200 text-slate-500",
};

export interface PersonAsset {
  id: string;
  person_id: string;
  asset_name: string;
  asset_type: string | null;
  identifier: string | null;
  assigned_date: string | null;
  returned_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonOnboardingItem {
  id: string;
  person_id: string;
  item_key: string;
  provided: boolean;
  provided_date: string | null;
  completed: boolean;
  completed_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonDocument {
  id: string;
  person_id: string;
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

/** A document plus a short-lived signed URL for download/preview. */
export interface PersonDocumentWithUrl extends PersonDocument {
  signed_url: string | null;
}

/** Recruiting summary surfaced on the employee History tab (read-only). */
export interface PersonRecruitingSummary {
  person_id: string;
  pipeline: string | null;
  stage: string | null;
  status_notes: string | null;
  source: string | null;
  interview_date: string | null;
  score: number | null;
  resume_url: string | null;
  keep_for_future: boolean | null;
  follow_up_date: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Standard pay-type options for the compensation dropdown. */
export const PAY_TYPE_LABELS: Record<string, string> = {
  Hourly: "Hourly",
  Salary: "Salary",
  Commission: "Commission",
  "Per Diem": "Per Diem",
  Contract: "Contract (1099)",
};

export const REVIEW_TYPE_LABELS: Record<string, string> = {  annual: "Annual Review",
  ninety_day: "90-Day Review",
  performance: "Performance Review",
  disciplinary: "Disciplinary",
  check_in: "Check-In",
  other: "Other",
};

export const ASSET_TYPE_LABELS: Record<string, string> = {
  laptop: "Laptop / Computer",
  phone: "Phone",
  badge: "Badge",
  key: "Key / Fob",
  scrubs: "Scrubs / Uniform",
  vehicle: "Vehicle",
  other: "Other",
};

export const ASSET_STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  returned: "Returned",
  lost: "Lost",
  damaged: "Damaged",
};

export const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  contract: "Contract / Offer",
  license: "License",
  certification: "Certification",
  id: "Identification",
  review: "Review",
  other: "Other",
};

export const STATUS_LABELS: Record<EmploymentStatus, string> = {
  prospect: "Prospect",
  applicant: "Applicant",
  employee: "Employee",
  former: "Former",
  contractor: "Contractor",
};

export const WORK_LOCATION_LABELS: Record<WorkLocationType, string> = {
  in_house: "In-House",
  remote: "Remote",
  hybrid: "Hybrid",
};

export const SCHEDULE_LABELS: Record<WorkSchedule, string> = {
  full_time: "Full-Time",
  part_time: "Part-Time",
  per_diem: "Per Diem",
  contractor: "Contractor",
};
