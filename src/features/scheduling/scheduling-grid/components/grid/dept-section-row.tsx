"use client";

import { ChevronDownIcon, PencilIcon, PlusIcon } from "lucide-react";
import { dateForDay } from "@/lib/schedule/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import { COL_W } from "@/features/scheduling/scheduling-grid/lib/grid-constants";
import type { GridColumn, GridTableRow } from "@/features/scheduling/scheduling-grid/types/grid-table";

/**
 * A department's section header — the table's group row for that department.
 * The name / toggle cell spans just the sticky "Shift" column; the day /
 * location cells that follow carry the booked-appointment demand so the number
 * lands under its clinic column, in the department's own colour.
 */
export function DeptSectionRow({
  row,
  cellColumns,
  span,
}: {
  row: GridTableRow;
  /** The visible (day, location) columns, in table order. */
  cellColumns: GridColumn[];
  /** Full-width colSpan, used when no location is shown. */
  span: number;
}) {
  const { week, departmentById, closureSet, agendaCountMap, canEdit, actions } = useGrid();
  const dept = departmentById.get(String(row.groupingValue));
  if (!dept) return null;
  const collapsed = !row.getIsExpanded();
  const lineCount = row.subRows.filter((r) => r.original.kind === "line").length;
  const showDemand = cellColumns.length > 0;
  const dayOf = (column: GridColumn | undefined) => {
    const meta = column?.columnDef.meta;
    return meta?.kind === "cell" ? meta.day : null;
  };

  return (
    <tr>
      <td
        colSpan={showDemand ? 1 : span}
        className="group/dept sticky left-0 z-10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white"
        style={{ background: dept.color }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => row.toggleExpanded()}
            title={collapsed ? "Expand department" : "Collapse department"}
            aria-expanded={!collapsed}
            className="flex flex-1 items-center gap-1.5 text-left hover:text-white/90"
          >
            <ChevronDownIcon
              className={`size-3 transition-transform ${collapsed ? "-rotate-90" : ""}`}
            />
            <span>{dept.name}</span>
            {collapsed && lineCount > 0 && (
              <span className="rounded bg-white/20 px-1.5 text-[9px] font-semibold">
                {lineCount}
              </span>
            )}
          </button>
          {canEdit && (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => actions.openLineModal({ line: null, deptId: dept.id })}
                      className="flex items-center gap-0.5 rounded bg-white/20 px-1.5 text-[10px] font-semibold opacity-0 transition hover:bg-white/30 group-hover/dept:opacity-100 print:hidden"
                    />
                  }
                >
                  <PlusIcon className="size-3" /> line
                </TooltipTrigger>
                <TooltipContent>Add shift line to this department</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => actions.openDeptModal(dept)}
                      aria-label="Edit department"
                      className="opacity-0 transition hover:text-white/80 group-hover/dept:opacity-100 print:hidden"
                    />
                  }
                >
                  <PencilIcon className="size-3" />
                </TooltipTrigger>
                <TooltipContent>Edit department</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </td>
      {showDemand &&
        cellColumns.map((column, i) => {
          const meta = column.columnDef.meta;
          if (meta?.kind !== "cell") return null;
          const { day, location } = meta;
          // A column starts a day when the column before it belongs to another day.
          const isDayStart = day !== dayOf(cellColumns[i - 1]);
          const closed = closureSet.has(`${location.id}|${day}`);
          const date = dateForDay(week.week_start, day);
          const count = agendaCountMap.get(`${dept.id}|${location.id}|${date}`) ?? 0;
          const width = closed ? 18 : COL_W;
          return (
            <td
              key={column.id}
              className="px-1 py-1 text-center text-[11px] font-bold tabular-nums text-white/95"
              style={{
                background: dept.color,
                width,
                minWidth: width,
                maxWidth: width,
                borderLeft: isDayStart
                  ? "2px solid rgba(255,255,255,0.5)"
                  : "1px solid rgba(255,255,255,0.25)",
              }}
              title={
                count > 0
                  ? `${count} appointment${count === 1 ? "" : "s"} booked — ${dept.name} @ ${location.short_code ?? location.name}`
                  : undefined
              }
            >
              {closed ? "" : count > 0 ? count : ""}
            </td>
          );
        })}
    </tr>
  );
}
