"use client";

import { PencilIcon, XIcon } from "lucide-react";
import { timeRange } from "@/lib/schedule/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CollapsibleCellContent } from "@/features/scheduling/scheduling-grid/components/grid/collapsible-cell-content";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import type { GridCellContext } from "@/features/scheduling/scheduling-grid/types/grid-table";

/**
 * The row header of a shift line: its label (or role), ad-hoc marker and time
 * range, with edit / delete controls that appear on hover. Lives in the sticky
 * "Shift" column; `ShiftLineRow` wraps it in the `<th scope="row">`.
 */
export function ShiftLineCell({ row }: GridCellContext) {
  const { roleName, canEdit, actions } = useGrid();
  const data = row.original;
  if (data.kind !== "line") return null;
  const { line } = data;
  return (
    <CollapsibleCellContent>
      <div className="flex min-h-[24px] items-start justify-between gap-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="whitespace-nowrap text-[12px] font-semibold text-slate-800">
            {line.label || roleName(line.role_id) || "Shift"}
            {line.is_adhoc && (
              <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-700">
                +
              </span>
            )}
          </span>
          <span className="whitespace-nowrap font-mono text-[11px] text-slate-500">
            {timeRange(line.start_time, line.end_time)}
          </span>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-1 opacity-0 transition group-hover/line:opacity-100 print:hidden">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => actions.openLineModal({ line })}
                    className="text-slate-400 hover:text-slate-900"
                    aria-label="Edit shift line"
                  />
                }
              >
                <PencilIcon className="size-3" />
              </TooltipTrigger>
              <TooltipContent>Edit shift line</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => actions.removeLine(line)}
                    className="text-slate-400 hover:text-red-600"
                    aria-label="Delete this row"
                  />
                }
              >
                <XIcon className="size-3" />
              </TooltipTrigger>
              <TooltipContent>Delete this row</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </CollapsibleCellContent>
  );
}
