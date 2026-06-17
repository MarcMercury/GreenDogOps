export interface PersonRecruiting {
  person_id: string;
  target_position_id: string | null;
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
  target_title: string | null;
  created_at: string;
  updated_at: string;
}

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
  opportunity_type: string | null;
  notes: string | null;
  source_contact_id: string | null;
  created_at: string;
  updated_at: string;
  person_recruiting: PersonRecruiting | null;
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
