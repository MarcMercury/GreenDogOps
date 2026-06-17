// Opportunity Types — the canonical list of ways someone can engage with Green
// Dog (externship, internship, shadowing, volunteer, cohort, Vet America mentee,
// W2 hire, 1099 contractor, etc). Source: "GDD Opportunity Types" document.
//
// This single source of truth is shared across the Student CRM, the ATS, and HR
// so a person's "nature of engagement" follows them from a student/visitor, to
// an applicant, to an employee. Values are stored as free text on
// greendogops.person.opportunity_type and greendogops.crm_contact.opportunity_type.

export type OpportunityGroup =
  | "Students & Trainees"
  | "Graduate / Mentorship"
  | "Employment";

export interface OpportunityType {
  /** Stored value (stable slug). */
  value: string;
  /** Human-readable label shown in dropdowns and badges. */
  label: string;
  /** Short label for compact UI (lists/badges). */
  shortLabel: string;
  /** Whether the engagement is paid. */
  paid: boolean;
  /** Optgroup the type belongs to. */
  group: OpportunityGroup;
}

export const OPPORTUNITY_TYPES: OpportunityType[] = [
  // ---- Students & Trainees -------------------------------------------------
  {
    value: "externship_unpaid",
    label: "Externship — Unpaid",
    shortLabel: "Externship (Unpaid)",
    paid: false,
    group: "Students & Trainees",
  },
  {
    value: "externship_paid",
    label: "Externship — Paid (Case-by-Case)",
    shortLabel: "Externship (Paid)",
    paid: true,
    group: "Students & Trainees",
  },
  {
    value: "internship_unpaid",
    label: "Internship — Unpaid (Educational Track)",
    shortLabel: "Internship (Unpaid)",
    paid: false,
    group: "Students & Trainees",
  },
  {
    value: "internship_paid",
    label: "Internship — Paid (Working Track)",
    shortLabel: "Internship (Paid)",
    paid: true,
    group: "Students & Trainees",
  },
  {
    value: "shadowing",
    label: "Student Shadowing / Break Experience — Unpaid",
    shortLabel: "Shadowing",
    paid: false,
    group: "Students & Trainees",
  },
  {
    value: "volunteer",
    label: "Volunteer Shift — Unpaid",
    shortLabel: "Volunteer",
    paid: false,
    group: "Students & Trainees",
  },
  {
    value: "cohort_paid",
    label: "Cohort / Intensive Program — Paid",
    shortLabel: "Cohort (Paid)",
    paid: true,
    group: "Students & Trainees",
  },
  {
    value: "intensive_unpaid",
    label: "2–4 Day Intensive — Unpaid",
    shortLabel: "Intensive (Unpaid)",
    paid: false,
    group: "Students & Trainees",
  },
  // ---- Graduate / Mentorship ----------------------------------------------
  {
    value: "rotating_internship",
    label: "Rotating Internship (Western University) — Unpaid",
    shortLabel: "Rotating Internship",
    paid: false,
    group: "Graduate / Mentorship",
  },
  {
    value: "vet_america_mentee",
    label: "Vet America Applicant / Mentee — Paid (Case-by-Case)",
    shortLabel: "Vet America Mentee",
    paid: true,
    group: "Graduate / Mentorship",
  },
  // ---- Employment ----------------------------------------------------------
  {
    value: "w2_hire",
    label: "W2 Hire — Paid",
    shortLabel: "W2 Hire",
    paid: true,
    group: "Employment",
  },
  {
    value: "contractor_1099",
    label: "1099 Contractor — Paid",
    shortLabel: "1099 Contractor",
    paid: true,
    group: "Employment",
  },
];

export const OPPORTUNITY_GROUPS: OpportunityGroup[] = [
  "Students & Trainees",
  "Graduate / Mentorship",
  "Employment",
];

const OPPORTUNITY_BY_VALUE: Record<string, OpportunityType> =
  Object.fromEntries(OPPORTUNITY_TYPES.map((o) => [o.value, o]));

/** Full label for a stored value (falls back to the raw value). */
export function opportunityLabel(value: string | null | undefined): string {
  if (!value) return "";
  return OPPORTUNITY_BY_VALUE[value]?.label ?? value;
}

/** Compact label for lists/badges (falls back to the raw value). */
export function opportunityShortLabel(value: string | null | undefined): string {
  if (!value) return "";
  return OPPORTUNITY_BY_VALUE[value]?.shortLabel ?? value;
}

/** Lookup the full definition for a stored value. */
export function opportunityType(
  value: string | null | undefined,
): OpportunityType | null {
  if (!value) return null;
  return OPPORTUNITY_BY_VALUE[value] ?? null;
}
