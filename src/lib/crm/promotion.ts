// Student CRM → Recruiting (ATS) promotion: what a student's CRM record turns
// into on the unified `person` + `person_recruiting` rows, and which students
// still belong on the Student CRM list. Kept pure so the mapping is testable;
// `promoteStudentToRecruiting` (crm/actions.ts) does the writes.

import { formatPhoneNumber } from "../shared/phone";
import type { CrmContact } from "./types";

export type PromotableStudent = Pick<
  CrmContact,
  | "id"
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "organization"
  | "program_type"
  | "program_name"
  | "program_subcategory"
  | "cohort"
  | "school"
  | "location"
  | "mentor"
  | "coordinator"
  | "start_date"
  | "end_date"
  | "hours_completed"
  | "hours_required"
  | "eligible_for_employment"
  | "opportunity_type"
  | "lead_source"
  | "supervising_dvm"
  | "weekday_schedule"
  | "doc_recommendation"
  | "degree_type"
  | "hire_interest"
  | "grad_year"
  | "stipend"
  | "notes"
>;

/** Columns `promoteStudentToRecruiting` must load for {@link studentToApplicant}. */
export const PROMOTABLE_STUDENT_COLUMNS = `id, first_name, last_name, full_name, email, phone,
  organization, program_type, program_name, program_subcategory, cohort, school,
  location, mentor, coordinator, start_date, end_date, hours_completed,
  hours_required, eligible_for_employment, opportunity_type, lead_source,
  supervising_dvm, weekday_schedule, doc_recommendation, degree_type,
  hire_interest, grad_year, stipend, notes, promoted_person_id`;

function clean(v: string | null | undefined): string | null {
  const s = v?.replace(/\s+/g, " ").trim();
  return s ? s : null;
}

/** "DVM — UC Davis (2027)" from whatever education facts the student has. */
export function studentEducation(
  s: Pick<PromotableStudent, "degree_type" | "school" | "grad_year">,
): string | null {
  const degree = clean(s.degree_type);
  const school = clean(s.school);
  const year = clean(s.grad_year);
  const head = [degree, school].filter(Boolean).join(" — ");
  if (!head) return year ? `Class of ${year}` : null;
  return year ? `${head} (${year})` : head;
}

/** One-line summary of the student's program for `person_recruiting.status_notes`. */
export function studentProgramSummary(s: PromotableStudent): string {
  const program = [clean(s.program_name), clean(s.program_subcategory)]
    .filter(Boolean)
    .join(" / ");
  const dates = [clean(s.start_date), clean(s.end_date)];
  const lines = [
    clean(s.school) ? `School: ${clean(s.school)}` : null,
    clean(s.degree_type) ? `Degree: ${clean(s.degree_type)}` : null,
    clean(s.program_type) ? `Program type: ${clean(s.program_type)}` : null,
    program ? `Program: ${program}` : null,
    clean(s.organization) ? `Organization: ${clean(s.organization)}` : null,
    clean(s.cohort) ? `Cohort: ${clean(s.cohort)}` : null,
    clean(s.grad_year) ? `Grad year: ${clean(s.grad_year)}` : null,
    clean(s.location) ? `Clinic: ${clean(s.location)}` : null,
    dates[0] || dates[1] ? `Dates: ${dates[0] ?? "?"} – ${dates[1] ?? "?"}` : null,
    clean(s.supervising_dvm) ? `DVM: ${clean(s.supervising_dvm)}` : null,
    clean(s.mentor) ? `Mentor: ${clean(s.mentor)}` : null,
    clean(s.coordinator) ? `Coordinator: ${clean(s.coordinator)}` : null,
    clean(s.weekday_schedule) ? `Schedule: ${clean(s.weekday_schedule)}` : null,
    clean(s.doc_recommendation) ? `Doc rec: ${clean(s.doc_recommendation)}` : null,
    clean(s.hire_interest) ? `Hire interest: ${clean(s.hire_interest)}` : null,
    clean(s.stipend) ? `Stipend: ${clean(s.stipend)}` : null,
    s.hours_completed != null || s.hours_required != null
      ? `Hours: ${s.hours_completed ?? "?"}/${s.hours_required ?? "?"}`
      : null,
    s.eligible_for_employment ? "Eligible for employment" : null,
  ].filter(Boolean);
  return lines.length > 0
    ? `From Student CRM — ${lines.join(" · ")}`
    : "Promoted from Student CRM";
}

/**
 * The `person` (applicant) and `person_recruiting` rows a promoted student
 * becomes. `today` is the promotion date (YYYY-MM-DD), used as the application
 * date so the candidate sorts correctly in the ATS.
 */
export function studentToApplicant(s: PromotableStudent, today: string) {
  const fullName =
    clean(s.full_name) ||
    [clean(s.first_name), clean(s.last_name)].filter(Boolean).join(" ") ||
    null;
  return {
    person: {
      status: "applicant" as const,
      first_name: clean(s.first_name),
      last_name: clean(s.last_name),
      full_name: fullName,
      email: clean(s.email),
      phone_mobile: formatPhoneNumber(s.phone),
      notes: s.notes,
      opportunity_type: s.opportunity_type,
      source_contact_id: s.id,
    },
    recruiting: {
      pipeline: "Students",
      stage: "New Lead",
      source: clean(s.lead_source) ?? "Student CRM",
      target_title: clean(s.program_name),
      application_date: today,
      education: studentEducation(s),
      status_notes: studentProgramSummary(s),
      notes: s.notes,
    },
  };
}

/**
 * A promoted student has moved to Recruiting (and maybe on to HR), so the
 * Student CRM list no longer shows them; their CRM record stays as history.
 */
export function isPromotedStudent(c: Pick<CrmContact, "promoted_person_id">): boolean {
  return Boolean(c.promoted_person_id);
}
