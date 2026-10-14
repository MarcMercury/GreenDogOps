import { classifyRole, emptyStaffing, type StaffingCounts } from "@/lib/planning/resolve";

export interface DayStaffingRole {
  id: string;
  name: string;
}

export interface DayStaffingLine {
  id: string;
  role_id: string | null;
  department_id: string | null;
}

export interface DayStaffingAssignment {
  person_id: string;
  line_id: string;
  removed_post_publish: boolean;
}

/**
 * The staffing signature of one (location, day) for a department: distinct
 * people per staffing category (DVM, Tech, Lead, …) among the active
 * assignments whose line belongs to that department, plus the DVM count the
 * generated planning guide is keyed by (never below 1 — a guide always has at
 * least one exam track).
 */
export function countDayStaffing(
  roles: DayStaffingRole[],
  lines: DayStaffingLine[],
  assignments: DayStaffingAssignment[],
  departmentId: string,
): { staffing: StaffingCounts; dvmCount: number } {
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const lineById = new Map(lines.map((l) => [l.id, l]));

  // Distinct people per staffing category staffed within this department.
  const staffSets = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (a.removed_post_publish) continue;
    const line = lineById.get(a.line_id);
    if (!line || line.department_id !== departmentId) continue;
    const role = line.role_id ? roleById.get(line.role_id) : null;
    const cat = classifyRole(role?.name);
    if (!cat) continue;
    let set = staffSets.get(cat);
    if (!set) {
      set = new Set<string>();
      staffSets.set(cat, set);
    }
    set.add(a.person_id);
  }

  const staffing = emptyStaffing();
  for (const [cat, set] of staffSets) {
    staffing[cat as keyof typeof staffing] = set.size;
  }
  const dvmCount = Math.max(1, staffing.dvm);
  return { staffing, dvmCount };
}
