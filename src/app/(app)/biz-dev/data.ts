import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PlanningTrackRules } from "@/lib/reporting/bizdev";

/**
 * The Planning Guide Setup rules the Operations guides run on: which department
 * renders each ezyVet appointment type, and which departments are planning
 * areas. The Biz Dev generator lays its day out with the same rules.
 */
export async function getPlanningTrackRules(): Promise<PlanningTrackRules> {
  const supabase = await createClient();
  const [deptRes, mapRes] = await Promise.all([
    supabase
      .from("sched_department")
      .select("id, name, color, show_in_planning")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("ezyvet_appt_type_dept_map")
      .select("appt_type, department_id, is_ignored"),
  ]);

  const departments = (deptRes.data ?? []) as {
    id: string;
    name: string;
    color: string;
    show_in_planning: boolean;
  }[];

  return {
    planningDepartments: departments
      .filter((d) => d.show_in_planning)
      .map((d) => ({ id: d.id, name: d.name, color: d.color })),
    departmentNames: Object.fromEntries(departments.map((d) => [d.id, d.name])),
    apptTypeDept: Object.fromEntries(
      (
        (mapRes.data ?? []) as {
          appt_type: string;
          department_id: string | null;
          is_ignored: boolean;
        }[]
      ).map((m) => [
        m.appt_type.trim(),
        { departmentId: m.department_id, isIgnored: m.is_ignored },
      ]),
    ),
  };
}
