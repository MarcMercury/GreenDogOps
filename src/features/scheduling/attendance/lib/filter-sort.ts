import type { AttendanceTableView } from "@/features/scheduling/attendance/types/attendance-sort";
import type { EmployeeAttendance } from "@/features/scheduling/attendance/types/employee-attendance";

/**
 * The table's view of the rollup: a case-insensitive match on the name, the
 * optional "only with recorded attendance" cut, then a sort on one column.
 * An employee with no score sorts as -1, so a descending Reliability sort puts
 * the unresolved at the bottom. Returns a new array; the input is untouched.
 */
export function filterAndSortEmployees(
  employees: EmployeeAttendance[],
  view: AttendanceTableView,
): EmployeeAttendance[] {
  const term = view.query.trim().toLowerCase();
  const rows = employees.filter((e) => {
    if (view.onlyResolved && e.tally.total === 0) return false;
    if (term && !e.name.toLowerCase().includes(term)) return false;
    return true;
  });

  const dir = view.sortDir === "asc" ? 1 : -1;
  const valueOf = (e: EmployeeAttendance): string | number => {
    if (view.sortKey === "name") return e.name.toLowerCase();
    if (view.sortKey === "score") return e.score ?? -1;
    if (view.sortKey === "total") return e.tally.total;
    return e.tally[view.sortKey];
  };

  return [...rows].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv) * dir;
    }
    return ((av as number) - (bv as number)) * dir;
  });
}
