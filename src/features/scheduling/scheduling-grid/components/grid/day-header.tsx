"use client";

import { DAY_SHORT, dateForDay } from "@/lib/schedule/types";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import type { GridHeaderContext } from "@/features/scheduling/scheduling-grid/types/grid-table";

/**
 * The day group header: weekday, the date (not on the template), and
 * "CLOSED" when every location shown is closed that day.
 */
export function DayHeader({ column }: GridHeaderContext) {
  const { week, templateMode, closureSet } = useGrid();
  const meta = column.columnDef.meta;
  if (meta?.kind !== "day") return null;
  const { day } = meta;
  const visible = column.columns.filter((c) => c.getIsVisible());
  const allClosed =
    visible.length > 0 &&
    visible.every((c) => {
      const m = c.columnDef.meta;
      return m?.kind === "cell" && closureSet.has(`${m.location.id}|${day}`);
    });
  return (
    <div className="flex flex-col items-center gap-0.5 py-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{DAY_SHORT[day]}</span>
      {!templateMode && (
        <span className="text-base font-bold leading-none text-slate-900">
          {new Date(`${dateForDay(week.week_start, day)}T00:00:00`).getDate()}
        </span>
      )}
      {allClosed && (
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Closed</span>
      )}
    </div>
  );
}
