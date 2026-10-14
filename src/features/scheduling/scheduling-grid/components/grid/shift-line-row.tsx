"use client";

import { cn } from "cn";
import styles from "@/features/scheduling/scheduling-grid/components/grid/grid.module.css";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import type { GridTable, GridTableRow } from "@/features/scheduling/scheduling-grid/types/grid-table";

/**
 * One shift line: the sticky row header (the `shift` column's cell) followed
 * by a cell per visible (day, location) column. The cell columns render their
 * own `<td>` (see `LocationCell`); the hidden grouping column has no cell.
 * `data-collapse` drives the open / close animation of its section.
 */
export function ShiftLineRow({ row, table }: { row: GridTableRow; table: GridTable }) {
  const { departmentById, sectionState } = useGrid();
  const dept = departmentById.get(row.original.departmentId);
  return (
    <tr
      data-collapse={sectionState(row.original.departmentId)}
      className={cn("group/line hover:bg-slate-50/40", styles.row)}
    >
      {row.getVisibleCells().map((cell) => {
        const kind = cell.column.columnDef.meta?.kind;
        if (kind === "shift") {
          return (
            <th
              key={cell.id}
              scope="row"
              className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-left align-top"
              style={{ borderLeft: `3px solid ${dept?.color ?? "#94a3b8"}` }}
            >
              <table.FlexRender cell={cell} />
            </th>
          );
        }
        if (kind === "cell") return <table.FlexRender key={cell.id} cell={cell} />;
        return null;
      })}
    </tr>
  );
}
