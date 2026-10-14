"use client";

import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { CollapsibleCellContent } from "@/features/scheduling/scheduling-grid/components/grid/collapsible-cell-content";
import styles from "@/features/scheduling/scheduling-grid/components/grid/grid.module.css";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import type { GridTableRow } from "@/features/scheduling/scheduling-grid/types/grid-table";

/** The one row under a department that has no shift lines yet. */
export function EmptyDeptRow({ row, span }: { row: GridTableRow; span: number }) {
  const { departmentById, canEdit, actions, sectionState } = useGrid();
  const dept = departmentById.get(row.original.departmentId);
  if (!dept) return null;
  return (
    <tr data-collapse={sectionState(dept.id)} className={cn(styles.row)}>
      <td
        colSpan={span}
        className="border-b border-slate-200 px-3 py-2 text-left text-xs text-slate-400"
        style={{ borderLeft: `3px solid ${dept.color}` }}
      >
        <CollapsibleCellContent>
          <div className="flex items-center gap-1">
            No shift lines for {dept.name} yet.
            {canEdit && (
              <Button
                variant="link"
                size="xs"
                className="print:hidden"
                onClick={() => actions.openLineModal({ line: null, deptId: dept.id })}
              >
                + Add shift line
              </Button>
            )}
          </div>
        </CollapsibleCellContent>
      </td>
    </tr>
  );
}
