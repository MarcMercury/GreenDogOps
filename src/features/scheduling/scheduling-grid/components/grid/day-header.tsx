"use client";

import { DAY_SHORT, dateForDay } from "@/lib/schedule/types";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import type { GridHeaderContext } from "@/features/scheduling/scheduling-grid/types/grid-table";

/** The day-of-week group header ("Mon 14"); the template shows no dates. */
export function DayHeader({ column }: GridHeaderContext) {
  const { week, templateMode } = useGrid();
  const meta = column.columnDef.meta;
  if (meta?.kind !== "day") return null;
  return (
    <>
      {DAY_SHORT[meta.day]}{" "}
      {!templateMode && (
        <span className="font-normal text-slate-400">
          {new Date(`${dateForDay(week.week_start, meta.day)}T00:00:00`).getDate()}
        </span>
      )}
    </>
  );
}
