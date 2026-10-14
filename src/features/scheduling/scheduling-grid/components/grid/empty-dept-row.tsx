"use client";

import { Button } from "@/components/ui/button";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import type { GridTableRow } from "@/features/scheduling/scheduling-grid/types/grid-table";

/** The one row under a department that has no shift lines yet. */
export function EmptyDeptRow({ row, span }: { row: GridTableRow; span: number }) {
  const { departmentById, canEdit, actions } = useGrid();
  const dept = departmentById.get(row.original.departmentId);
  if (!dept) return null;
  return (
    <tr>
      <td
        colSpan={span}
        className="border-b border-slate-200 px-3 py-2 text-left text-xs text-slate-400"
        style={{ borderLeft: `3px solid ${dept.color}` }}
      >
        No shift lines for {dept.name} yet.
        {canEdit && (
          <Button
            variant="link"
            size="xs"
            className="ml-1 print:hidden"
            onClick={() => actions.openLineModal({ line: null, deptId: dept.id })}
          >
            + Add shift line
          </Button>
        )}
      </td>
    </tr>
  );
}
