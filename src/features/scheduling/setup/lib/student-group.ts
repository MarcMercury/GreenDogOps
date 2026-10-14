import type { SchedDepartment, SchedRole } from "@/lib/schedule/types";

// Synthetic "Student" department injected into the eligibility matrix. Mentor
// and Coordinator are NOT shifts (no one is ever scheduled for them) — they are
// person-level flags on `sched_employee_setting` that decide who appears in the
// Student CRM Mentor / Coordinator dropdowns. Modeling them as pseudo-columns
// lets the same matrix edit them alongside the real shift roles.
export const STUDENT_DEPT_ID = "__student";
export const STUDENT_MENTOR_ID = "__student_mentor";
export const STUDENT_COORDINATOR_ID = "__student_coordinator";

export const STUDENT_GROUP: { dept: SchedDepartment; roles: SchedRole[] } = {
  dept: {
    id: STUDENT_DEPT_ID,
    name: "Student",
    code: "STU",
    color: "#7c3aed",
    sort_order: 9999,
    is_active: true,
    show_in_planning: false,
    created_at: "",
    updated_at: "",
  },
  roles: [
    {
      id: STUDENT_MENTOR_ID,
      department_id: STUDENT_DEPT_ID,
      name: "Mentor",
      sort_order: 0,
      is_active: true,
      created_at: "",
      updated_at: "",
    },
    {
      id: STUDENT_COORDINATOR_ID,
      department_id: STUDENT_DEPT_ID,
      name: "Coordinator",
      sort_order: 1,
      is_active: true,
      created_at: "",
      updated_at: "",
    },
  ],
};
