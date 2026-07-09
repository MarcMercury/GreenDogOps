// Shared types + labels for the profile transition log (greendogops.profile_transition_log).
// A profile (a person and/or its originating Student CRM contact) moves through
// stages — Student CRM → ATS → HR/Roster — and every move is recorded here so
// the history travels with the profile and is visible on the ATS + HR pages.

export interface ProfileTransition {
  id: string;
  person_id: string | null;
  contact_id: string | null;
  event_type: string;
  from_stage: string | null;
  to_stage: string | null;
  detail: string | null;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
}

export const TRANSITION_EVENT_LABELS: Record<string, string> = {
  promoted_to_ats: "Promoted to Recruiting (ATS)",
  hired_to_roster: "Hired to Roster",
  direct_entry: "Direct entry",
  documents_migrated: "Documents migrated",
  status_change: "Status changed",
};

export const STAGE_LABELS: Record<string, string> = {
  student: "Student CRM",
  prospect: "Prospect",
  applicant: "ATS Candidate",
  employee: "Employee",
  contractor: "Contractor",
  former: "Former",
};

export function transitionEventLabel(value: string): string {
  return TRANSITION_EVENT_LABELS[value] ?? value;
}

export function stageLabel(value: string | null): string | null {
  if (!value) return null;
  return STAGE_LABELS[value] ?? value;
}
