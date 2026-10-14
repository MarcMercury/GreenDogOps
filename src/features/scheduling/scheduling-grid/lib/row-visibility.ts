import type { SchedDepartment } from "@/lib/schedule/types";
import type { GridRow } from "@/features/scheduling/scheduling-grid/types/grid-row";

/** Pseudo department id of the PTO section in the Rows card. */
export const PTO_ROW_ID = "pto";

/** What the Rows card has hidden: whole departments (by id) and single shift lines (by line id). */
export interface RowVisibility {
  departments: ReadonlySet<string>;
  lines: ReadonlySet<string>;
}

export const NOTHING_HIDDEN: RowVisibility = { departments: new Set(), lines: new Set() };

/** The grid rows that are not hidden — the table's `data`. */
export function applyRowVisibility(rows: GridRow[], hidden: RowVisibility): GridRow[] {
  return rows.filter(
    (r) => !hidden.departments.has(r.departmentId) && (r.kind !== "line" || !hidden.lines.has(r.line.id)),
  );
}

/** "N of M shown" for the Rows card; the PTO section counts as one row when present. */
export function rowVisibilityCounts(
  rows: GridRow[],
  hidden: RowVisibility,
  { withPto }: { withPto: boolean },
): { shown: number; total: number } {
  const visible = applyRowVisibility(rows, hidden).length;
  const pto = withPto ? 1 : 0;
  const ptoShown = withPto && !hidden.departments.has(PTO_ROW_ID) ? 1 : 0;
  return { shown: visible + ptoShown, total: rows.length + pto };
}

export interface RowsCardDepartment {
  dept: SchedDepartment;
  lines: Extract<GridRow, { kind: "line" }>[];
}

/** The departments on the grid, in grid order, each with its shift lines — the Rows card's list. */
export function departmentsForRowsCard(
  rows: GridRow[],
  departmentById: Map<string, SchedDepartment>,
): RowsCardDepartment[] {
  const out: RowsCardDepartment[] = [];
  const byId = new Map<string, RowsCardDepartment>();
  for (const row of rows) {
    let entry = byId.get(row.departmentId);
    if (!entry) {
      const dept = departmentById.get(row.departmentId);
      if (!dept) continue;
      entry = { dept, lines: [] };
      byId.set(row.departmentId, entry);
      out.push(entry);
    }
    if (row.kind === "line") entry.lines.push(row);
  }
  return out;
}

/** A set with `id` toggled in or out. */
export function toggled(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
