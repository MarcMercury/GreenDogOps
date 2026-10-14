"use client";

import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import type { GridTable, GridTableRow } from "@/features/scheduling/scheduling-grid/types/grid-table";

/**
 * One shift line: the sticky row header (the `shift` column's cell) followed
 * by a cell per visible (day, location) column. The cell columns render their
 * own `<td>` (see `LocationCell`); the hidden grouping column has no cell.
 */
export function ShiftLineRow({ row, table }: { row: GridTableRow; table: GridTable }) {
  const { departmentById } = useGrid();
  const dept = departmentById.get(row.original.departmentId);
  return (
    <tr className="group/line hover:bg-slate-50/40">
      {row.getVisibleCells().map((cell) => {
        const kind = cell.column.columnDef.meta?.kind;
        if (kind === "shift") {
          return (
            <th
              key={cell.id}
              scope="row"
              className="sticky left-0 z-10 border-b border-r border-slate-300 bg-white px-3 py-1.5 text-left align-top"
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
