/**
 * Editable shift-role eligibility for a single employee, grouped by department.
 * Mirrors the "Roles & Eligibility" data in Schedule → Setup so the employee
 * profile can manage the same `sched_role_member` rows. `selectedRoleIds` is the
 * set of roles this person is currently eligible for.
 */
export interface PersonRoleEligibility {
  departments: { id: string; name: string }[];
  roles: { id: string; department_id: string; name: string }[];
  selectedRoleIds: string[];
  /** Non-shift student flags — drive the CRM Mentor / Coordinator dropdowns. */
  isStudentMentor: boolean;
  isStudentCoordinator: boolean;
}
