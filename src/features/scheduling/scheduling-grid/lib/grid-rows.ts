import type { SchedDepartment, SchedWeekLine } from "@/lib/schedule/types";
import type { GridRow } from "@/features/scheduling/scheduling-grid/types/grid-row";

/**
 * The table's data: shift lines in department order (departments by
 * `sort_order`, lines by `sort_order` within each), ready to be grouped by
 * `departmentId`. The grouped row model keeps first-appearance order, so the
 * department order here is the section order on the grid.
 *
 * The template is where shift lines are authored, so every active department
 * stays visible there even before it has a line; a real week shows only
 * departments that have lines or booked appointments. A department with no
 * lines gets one `empty` row so its section (and its "+ Add shift line") still
 * renders.
 */
export function buildGridRows({
  lines,
  departments,
  templateMode,
  agendaDeptIds,
}: {
  lines: SchedWeekLine[];
  departments: SchedDepartment[];
  templateMode: boolean;
  agendaDeptIds: Set<string>;
}): GridRow[] {
  const byDept = new Map<string, SchedWeekLine[]>();
  for (const l of lines) {
    if (!byDept.has(l.department_id)) byDept.set(l.department_id, []);
    byDept.get(l.department_id)!.push(l);
  }
  const order = [...departments]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((d) =>
      templateMode ? d.is_active : byDept.has(d.id) || agendaDeptIds.has(d.id),
    );

  const rows: GridRow[] = [];
  for (const dept of order) {
    const deptLines = (byDept.get(dept.id) ?? []).sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    if (deptLines.length === 0) {
      rows.push({ kind: "empty", id: `empty:${dept.id}`, departmentId: dept.id });
      continue;
    }
    for (const line of deptLines) {
      rows.push({ kind: "line", id: line.id, departmentId: dept.id, line });
    }
  }
  return rows;
}
