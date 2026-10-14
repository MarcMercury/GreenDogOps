import type {
  SchedDepartment,
  SchedEmployeeSetting,
  SchedRole,
  SchedRoleMember,
} from "@/lib/schedule/types";
import {
  STUDENT_COORDINATOR_ID,
  STUDENT_GROUP,
  STUDENT_MENTOR_ID,
} from "@/features/scheduling/setup/lib/student-group";

export interface DeptGroup {
  dept: SchedDepartment;
  roles: SchedRole[];
}

/**
 * One visible column of the eligibility matrix: a role, a collapsed department
 * (a single narrow strip), or an expanded department that has no roles yet.
 */
export type MatrixColumn =
  | { kind: "role"; role: SchedRole }
  | { kind: "collapsed"; deptId: string }
  | { kind: "empty"; deptId: string };

/** Key of one (role, person) cell in the optimistic eligibility set. */
export function eligibilityKey(roleId: string, personId: string): string {
  return `${roleId}:${personId}`;
}

/**
 * Optimistic eligibility set, keyed by "roleId:personId". Real shift roles
 * come from `sched_role_member`; the synthetic Student pseudo-roles come from
 * the per-employee `is_student_mentor` / `is_student_coordinator` flags.
 */
export function initialEligibility(
  members: Pick<SchedRoleMember, "role_id" | "person_id">[],
  settings: Pick<
    SchedEmployeeSetting,
    "person_id" | "is_student_mentor" | "is_student_coordinator"
  >[],
): Set<string> {
  const s = new Set<string>();
  for (const m of members) s.add(eligibilityKey(m.role_id, m.person_id));
  for (const st of settings) {
    if (st.is_student_mentor) s.add(eligibilityKey(STUDENT_MENTOR_ID, st.person_id));
    if (st.is_student_coordinator)
      s.add(eligibilityKey(STUDENT_COORDINATOR_ID, st.person_id));
  }
  return s;
}

/**
 * Roles grouped by department, in configured order — drives the columns.
 * Every department defined in the Departments tab gets a section, even before
 * it has any roles, so the matrix always mirrors the department list. The
 * synthetic Student group is always appended last.
 */
export function buildDeptGroups(
  departments: SchedDepartment[],
  roles: SchedRole[],
): DeptGroup[] {
  return [
    ...departments.map((dept) => ({
      dept,
      roles: roles
        .filter((r) => r.department_id === dept.id)
        .sort((a, b) => a.sort_order - b.sort_order),
    })),
    STUDENT_GROUP,
  ];
}

/**
 * Flattened visible columns: expanded departments contribute one column per
 * role (or a single "no roles" placeholder), collapsed departments collapse to
 * a single narrow strip.
 */
export function buildMatrixColumns(
  deptGroups: DeptGroup[],
  collapsed: Set<string>,
): MatrixColumn[] {
  const cols: MatrixColumn[] = [];
  for (const g of deptGroups) {
    if (collapsed.has(g.dept.id)) cols.push({ kind: "collapsed", deptId: g.dept.id });
    else if (g.roles.length === 0) cols.push({ kind: "empty", deptId: g.dept.id });
    else for (const r of g.roles) cols.push({ kind: "role", role: r });
  }
  return cols;
}

/**
 * Employees — the rows. Only people flagged Scheduling Active in HR / Roster
 * are ever scheduled, so they are the only ones worth an eligibility row.
 */
export function schedulablePersonIds(
  settings: Pick<SchedEmployeeSetting, "person_id" | "is_schedulable">[],
): Set<string> {
  return new Set(settings.filter((s) => s.is_schedulable).map((s) => s.person_id));
}

/** The Student pseudo-roles are flags on the employee, not `sched_role_member` rows. */
export function isStudentFlagRole(roleId: string): boolean {
  return roleId === STUDENT_MENTOR_ID || roleId === STUDENT_COORDINATOR_ID;
}

/**
 * Both student flags to persist when one is toggled: the flag not being
 * toggled keeps its current value from the eligibility set.
 */
export function nextStudentFlags(
  roleId: string,
  personId: string,
  wasEligible: boolean,
  elig: Set<string>,
): { mentor: boolean; coordinator: boolean } {
  const mentor =
    roleId === STUDENT_MENTOR_ID
      ? !wasEligible
      : elig.has(eligibilityKey(STUDENT_MENTOR_ID, personId));
  const coordinator =
    roleId === STUDENT_COORDINATOR_ID
      ? !wasEligible
      : elig.has(eligibilityKey(STUDENT_COORDINATOR_ID, personId));
  return { mentor, coordinator };
}
