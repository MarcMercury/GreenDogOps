export interface PersonRecruiting {
  person_id: string;
  target_position_id: string | null;
  pipeline: string | null;
  stage: string | null;
  status_notes: string | null;
  source: string | null;
  application_date: string | null;
  interview_date: string | null;
  score: number | null;
  resume_url: string | null;
  keep_for_future: boolean | null;
  follow_up_date: string | null;
  notes: string | null;
  target_title: string | null;
  created_at: string;
  updated_at: string;
}

export interface InterviewResponse {
  question: string;
  answer: string | null;
}

export interface PersonInterview {
  id: string;
  person_id: string;
  interview_date: string | null;
  interview_type: string | null;
  interviewer: string | null;
  location: string | null;
  status: string;
  overall_grade: string | null;
  recommendation: string | null;
  summary: string | null;
  responses: InterviewResponse[];
  created_at: string;
  updated_at: string;
}

export const INTERVIEW_TYPE_LABELS: Record<string, string> = {
  phone_screen: "Phone Screen",
  in_person: "In-Person Interview",
  working_interview: "Working Interview",
  final: "Final / Decision",
  other: "Other",
};

// Canonical dropdown options for the candidate form.
export const RECRUITING_PIPELINE_OPTIONS = [
  { value: "MVS New Hires", label: "MVS New Hires" },
  { value: "MVS Staff Outreach", label: "MVS Staff Outreach" },
  { value: "MVS Vet Outreach", label: "MVS Vet Outreach" },
  { value: "All In House Positions", label: "All In House Positions" },
  { value: "Remote CSR", label: "Remote CSR" },
  { value: "DVM Vet America", label: "DVM Vet America" },
  { value: "Volunteers, Externs", label: "Volunteers / Externs" },
  { value: "Hired", label: "Hired" },
] as const;

export const RECRUITING_SOURCE_OPTIONS = [
  { value: "Indeed", label: "Indeed" },
  { value: "ZipRecruiter", label: "ZipRecruiter" },
  { value: "Career Builder", label: "Career Builder" },
  { value: "GD Website", label: "GD Website" },
  { value: "Social Media", label: "Social Media" },
  { value: "Facebook", label: "Facebook" },
  { value: "Personal Referral", label: "Personal Referral" },
  { value: "Other", label: "Other" },
] as const;

// Common positions candidates apply for. Used as datalist suggestions on the
// import/edit forms; the field stays free-text so unusual titles still save.
export const RECRUITING_POSITION_OPTIONS = [
  "DVM",
  "CSR",
  "Vet Tech",
  "Vet Assistant",
  "Practice Manager",
  "Receptionist",
  "Kennel Technician",
  "Groomer",
  "Remote CSR",
  "Volunteer / Extern",
] as const;

export const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  no_show: "No Show",
  cancelled: "Cancelled",
};

export const INTERVIEW_STATUS_BADGE: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  no_show: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-200 text-slate-600",
};

export const INTERVIEW_RECOMMENDATION_LABELS: Record<string, string> = {
  advance: "Advance",
  hold: "Hold / Maybe",
  pass: "Pass",
};

export const INTERVIEW_GRADE_OPTIONS = ["A", "B", "C", "D", "F"] as const;

// Structured phone-screen prompts ported from the "IN HOUSE CSR INTERVIEW
// TEMPLATE". Rendered as the default question set on the Interview Tracking tab.
export const CSR_PHONE_SCREEN_QUESTIONS: string[] = [
  "Veterinary Experience — Can you briefly walk me through your experience in veterinary medicine (clinical, customer service, or both)? What position is ideal for you?",
  "Technology & Software Skills — Have you used EzyVet before? If not, what veterinary software have you worked with? Are you comfortable with Google Drive/Docs/spreadsheets, and have you used Slack or a similar tool?",
  "Client or Coworker Situation — Can you share a quick example of a time you handled a challenging client or coworker situation? How did you handle it?",
  "Reliability — Would you say you're reliable? Do you call out often, show up late, or have trouble following through? How would past coworkers or managers describe your reliability?",
  "Self-Awareness & Team Fit — What would your coworkers say is the best thing about working with you? What's one thing they might say you could improve on?",
  "Location & Schedule — Are you open to working in Sherman Oaks, Van Nuys, Venice, or all of the above? Any day or time restrictions?",
  "Future — Are you looking for a long-term position? What kind of role are you hoping to grow into?",
];

export interface CandidateRow {
  id: string;
  status: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone_mobile: string | null;
  phone_home: string | null;
  phone_other: string | null;
  date_of_birth: string | null;
  postal_code: string | null;
  opportunity_type: string | null;
  notes: string | null;
  source_contact_id: string | null;
  created_at: string;
  updated_at: string;
  person_recruiting: PersonRecruiting | null;
  interview_meta?: CandidateInterviewMeta | null;
}

// Lightweight per-candidate interview rollup for the pipeline list view.
export interface CandidateInterviewMeta {
  count: number;
  next_date: string | null; // soonest upcoming "scheduled" interview
  last_grade: string | null; // grade of the most recent graded interview
}

// Normalize a free-form stage string into a coarse bucket for filtering/badges.
export type StageBucket =
  | "hired"
  | "active"
  | "future"
  | "passed"
  | "no_response"
  | "other";

export const STAGE_BUCKET_LABELS: Record<StageBucket, string> = {
  hired: "Hired",
  active: "Active",
  future: "Keep for Future",
  passed: "Passed",
  no_response: "No Response",
  other: "Other",
};

export function bucketForStage(stage: string | null): StageBucket {
  const s = (stage ?? "").toLowerCase();
  if (!s) return "other";
  if (s.includes("hire") && !s.includes("no hire")) return "hired";
  if (s.includes("volunteer") || s.includes("interview") || s.includes("shadow") || s.includes("offer") || s.includes("decision") || s.includes("new lead") || s.includes("phone"))
    return "active";
  if (s.includes("future") || s.includes("hold") || s.includes("remain")) return "future";
  if (s.includes("no hire") || s.includes("not moving") || s.includes("declined") || s.includes("quit") || s.includes("pass") || s.includes("seperated") || s.includes("separated"))
    return "passed";
  if (s.includes("response") || s.includes("did not respond") || s.includes("respond"))
    return "no_response";
  return "other";
}

export const STAGE_BADGE: Record<StageBucket, string> = {
  hired: "bg-emerald-100 text-emerald-800",
  active: "bg-blue-100 text-blue-800",
  future: "bg-amber-100 text-amber-800",
  passed: "bg-slate-200 text-slate-600",
  no_response: "bg-rose-100 text-rose-700",
  other: "bg-slate-100 text-slate-500",
};
