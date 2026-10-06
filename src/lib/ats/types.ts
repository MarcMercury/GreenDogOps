import {
  SCHEDULE_LABELS,
  WORK_LOCATION_LABELS,
  type WorkLocationType,
  type WorkSchedule,
} from "../hr/types";

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
  review_status: ReviewStatus | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  candidate_location: string | null;
  relevant_experience: string | null;
  education: string | null;
  job_location: string | null;
  interest_level: string | null;
  external_status: string | null;
  source_detail: string | null;
  screening_answers: ScreeningAnswer[] | null;
  application_history: ApplicationHistoryEntry[] | null;
  slack_announce_ts: string | null;
  slack_announce_channel: string | null;
  announced_at: string | null;
  announced_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One screening question from the job posting, with the candidate's answer. */
export interface ScreeningAnswer {
  question: string;
  answer: string | null;
  /** Whether the answer met the posting's requirement: "Yes", "No" or "N/A". */
  match: string | null;
}

/** One application this person submitted. Newest first. */
export interface ApplicationHistoryEntry {
  date: string | null;
  job_title: string | null;
  job_location: string | null;
  status: string | null;
  interest_level: string | null;
  source: string | null;
}

/** Recruiter interest carried over from the job board. */
export const RECRUITING_INTEREST_OPTIONS = [
  { value: "Yes", label: "Yes — interested" },
  { value: "Maybe", label: "Maybe" },
  { value: "Reject", label: "Reject" },
] as const;

// Intake triage state. Auto-ingested applicants (Gmail / Indeed webhook) start
// as "pending"; a recruiter accepts (→ active lead) or declines them. Manual
// entries default to "accepted" so they skip the queue.
export type ReviewStatus = "pending" | "accepted" | "declined";

// Stage set when an applicant is accepted from the review queue into the
// active pipeline, and when one is declined. Kept here so the intake actions
// and the pipeline bucketing agree on the wording.
export const ACCEPTED_LEAD_STAGE = "New Lead";
export const DECLINED_STAGE = "Declined";

// The recruiting team's stages, in pipeline order. The stage column stays free
// text so legacy/imported values still display; the dropdowns offer these.
export const RECRUITING_STAGE_OPTIONS = [
  "New Lead",
  "Contacted",
  "Phone Screen",
  "Zoom/Virtual Interview",
  "In-Person / Shadow Day",
  "Doc Call",
  "Offer",
  "Hired",
  "Hold for Future",
  "No Response",
  "Passed",
  "Declined",
] as const;

export type RecruitingStage = (typeof RECRUITING_STAGE_OPTIONS)[number];

export function isRecruitingStage(v: string): v is RecruitingStage {
  return (RECRUITING_STAGE_OPTIONS as readonly string[]).includes(v);
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
  start_time: string | null;
  end_time: string | null;
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
  task_meta?: CandidateTaskMeta | null;
}

// Open follow-up tasks per candidate for the pipeline list view.
export interface CandidateTaskMeta {
  open: number;
  next_due: string | null; // earliest due date among open tasks
}

/** A logged call / text / email / note on a candidate. In-app only. */
export interface RecruitingActivity {
  id: string;
  person_id: string;
  activity_type: string;
  body: string;
  occurred_at: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  call: "Call",
  text: "Text",
  email: "Email",
  note: "Note",
};

/** A dated follow-up on a candidate. */
export interface RecruitingTask {
  id: string;
  person_id: string;
  title: string;
  details: string | null;
  due_date: string | null;
  is_done: boolean;
  completed_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** An open (or recently filled) position on the hiring board. */
export interface PositionRow {
  id: string;
  title: string;
  location: string | null;
  priority: string;
  status: string;
  openings: number;
  notes: string | null;
  employment_type: WorkSchedule | null;
  /** Weekdays that must be covered, 0=Sun..6=Sat; empty = flexible. */
  days_needed: number[] | null;
  shift_start: string | null;
  shift_end: string | null;
  hours_per_week: number | null;
  work_location_type: WorkLocationType | null;
  pay_min: number | null;
  pay_max: number | null;
  pay_type: PositionPayType | null;
  target_start_date: string | null;
  description: string | null;
  requirements: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type PositionPayType = "hourly" | "salary";

export const POSITION_EMPLOYMENT_LABELS: Record<WorkSchedule, string> = SCHEDULE_LABELS;
export const POSITION_WORK_LOCATION_LABELS: Record<WorkLocationType, string> =
  WORK_LOCATION_LABELS;
export const POSITION_PAY_TYPE_LABELS: Record<PositionPayType, string> = {
  hourly: "Hourly",
  salary: "Salary",
};

/** Sunday-first, matching the schedule module's 0=Sun..6=Sat numbering. */
export const POSITION_DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "Mon–Fri", "Sat, Sun", "Every day", or "Mon, Wed, Fri". */
export function formatDaysNeeded(days: number[] | null | undefined): string | null {
  if (!days || days.length === 0) return null;
  const set = new Set(days);
  if (set.size === 7) return "Every day";
  const weekdays = [1, 2, 3, 4, 5];
  if (set.size === 5 && weekdays.every((d) => set.has(d))) return "Mon–Fri";
  if (set.size === 2 && set.has(0) && set.has(6)) return "Sat, Sun";
  // Monday-first reads more naturally for recruiters.
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => set.has(d))
    .map((d) => POSITION_DAY_SHORT[d])
    .join(", ");
}

/** "$22–$28/hr", "$85k–$110k/yr", "From $25/hr". */
export function formatPayRange(
  p: Pick<PositionRow, "pay_min" | "pay_max" | "pay_type">,
): string | null {
  const { pay_min: min, pay_max: max, pay_type: type } = p;
  if (min == null && max == null) return null;
  const fmt = (n: number) =>
    type === "salary" && n >= 1000
      ? `$${Number((n / 1000).toFixed(1))}k`
      : `$${Number(n.toFixed(2)).toLocaleString("en-US")}`;
  const unit = type === "salary" ? "/yr" : type === "hourly" ? "/hr" : "";
  if (min != null && max != null) {
    return min === max ? `${fmt(min)}${unit}` : `${fmt(min)}–${fmt(max)}${unit}`;
  }
  return min != null ? `From ${fmt(min)}${unit}` : `Up to ${fmt(max as number)}${unit}`;
}

/** "8:00 AM – 6:00 PM" from two pg times. */
export function formatShift(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const s = formatTime(start);
  const e = formatTime(end);
  if (s && e) return `${s} – ${e}`;
  return s ? `Starts ${s}` : e ? `Ends ${e}` : null;
}

export const POSITION_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  on_hold: "On Hold",
  filled: "Filled",
  closed: "Closed",
};

export const POSITION_STATUS_BADGE: Record<string, string> = {
  open: "bg-emerald-100 text-emerald-800",
  on_hold: "bg-amber-100 text-amber-800",
  filled: "bg-blue-100 text-blue-800",
  closed: "bg-slate-200 text-slate-600",
};

export const POSITION_PRIORITY_LABELS: Record<string, string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const POSITION_PRIORITY_BADGE: Record<string, string> = {
  high: "bg-rose-100 text-rose-700",
  normal: "bg-slate-100 text-slate-600",
  low: "bg-slate-50 text-slate-400",
};

/** "CSR — Van Nuys" */
export function positionLabel(p: Pick<PositionRow, "title" | "location">): string {
  return p.location ? `${p.title} — ${p.location}` : p.title;
}

/** "10:30 AM" from a pg time ("10:30:00") or an <input type="time"> value. */
export function formatTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const [hh, mm] = t.split(":");
  const h = Number(hh);
  if (Number.isNaN(h)) return t;
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${mm ?? "00"} ${suffix}`;
}

// Lightweight per-candidate interview rollup for the pipeline list view.
export interface CandidateInterviewMeta {
  count: number;
  next_date: string | null; // soonest upcoming "scheduled" interview
  last_grade: string | null; // grade of the most recent graded interview
}

// A candidate's attached document (resume, cover letter, etc.) plus a
// short-lived signed download URL. Returned by the `getCandidateDocuments`
// action for the Review Queue's expandable tile.
export interface CandidateDocument {
  id: string;
  title: string;
  category: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  source: string | null;
  uploaded_at: string;
  signed_url: string | null;
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
  if (s.includes("future") || s.includes("hold") || s.includes("remain")) return "future";
  if (
    s.includes("volunteer") ||
    s.includes("interview") ||
    s.includes("shadow") ||
    s.includes("offer") ||
    s.includes("decision") ||
    s.includes("new lead") ||
    s.includes("phone") ||
    s.includes("contact") ||
    s.includes("doc call") ||
    // Job-board dispositions carried in by the Indeed import.
    s.includes("contacting") ||
    s === "reviewed"
  )
    return "active";
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
