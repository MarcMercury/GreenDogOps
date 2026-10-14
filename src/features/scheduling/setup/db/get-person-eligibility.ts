import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PersonRoleEligibility } from "@/features/scheduling/setup/types/person-role-eligibility";

/** One employee's shift-role eligibility and student flags, for the HR profile. */
export async function getPersonEligibility(
  personId: string,
): Promise<PersonRoleEligibility> {
  const supabase = await createClient();
  const [deptRes, roleRes, memRes, settingRes] = await Promise.all([
    supabase
      .from("sched_department")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("sched_role")
      .select("id, department_id, name")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("sched_role_member")
      .select("role_id")
      .eq("person_id", personId),
    supabase
      .from("sched_employee_setting")
      .select("is_student_mentor, is_student_coordinator")
      .eq("person_id", personId)
      .maybeSingle(),
  ]);

  const setting = settingRes.data as {
    is_student_mentor: boolean | null;
    is_student_coordinator: boolean | null;
  } | null;

  return {
    departments: (deptRes.data ?? []) as { id: string; name: string }[],
    roles: (roleRes.data ?? []) as {
      id: string;
      department_id: string;
      name: string;
    }[],
    selectedRoleIds: ((memRes.data ?? []) as { role_id: string }[]).map(
      (m) => m.role_id,
    ),
    isStudentMentor: setting?.is_student_mentor ?? false,
    isStudentCoordinator: setting?.is_student_coordinator ?? false,
  };
}
