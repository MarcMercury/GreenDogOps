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
  date_of_birth: string | null;
  postal_code: string | null;
  work_location_type: WorkLocationType | null;
  avatar_url: string | null;
  is_active: boolean;
  notes: string | null;
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
