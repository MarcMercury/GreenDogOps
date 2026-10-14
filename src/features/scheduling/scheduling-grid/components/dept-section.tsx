"use client";

import {
  dateForDay,
  type SchedDepartment,
  type ScheduleLocation,
} from "@/lib/schedule/types";
import { COL_W, DAYS } from "@/features/scheduling/scheduling-grid/lib/grid-constants";

/** Department section header row (with the booked-appointment demand per cell), followed by its shift-line rows. */
export function DeptSection({
  dept,
  span,
  collapsed,
  lineCount,
  shownLocations,
  closureSet,
  weekStart,
  agendaCountMap,
  onToggle,
  onAddLine,
  onEditDept,
  children,
}: {
  dept: SchedDepartment;
  span: number;
  collapsed: boolean;
  lineCount: number;
  shownLocations: ScheduleLocation[];
  closureSet: Set<string>;
  weekStart: string;
  agendaCountMap: Map<string, number>;
  onToggle: () => void;
  onAddLine: () => void;
  onEditDept: () => void;
  children: React.ReactNode;
}) {
  // The dept name/toggle cell spans just the sticky "Shift" column; the day/
  // location cells that follow carry the booked-appointment demand so the
  // number lands under its clinic column, in the department's own color.
  const showDemand = shownLocations.length > 0;
  return (
    <>
      <tr>
        <td
          colSpan={showDemand ? 1 : span}
          className="group/dept sticky left-0 z-10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white"
          style={{ background: dept.color }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={onToggle}
              title={collapsed ? "Expand department" : "Collapse department"}
              aria-expanded={!collapsed}
              className="flex flex-1 items-center gap-1.5 text-left hover:text-white/90"
            >
              <span
                className={`inline-block text-[9px] transition-transform ${
                  collapsed ? "-rotate-90" : ""
                }`}
              >
                ▼
              </span>
              <span>{dept.name}</span>
              {collapsed && lineCount > 0 && (
                <span className="rounded bg-white/20 px-1.5 text-[9px] font-semibold">
                  {lineCount}
                </span>
              )}
            </button>
            <button
              onClick={onAddLine}
              title="Add shift line to this department"
              className="rounded bg-white/20 px-1.5 text-[10px] font-semibold opacity-0 transition hover:bg-white/30 group-hover/dept:opacity-100 print:hidden"
            >
              + line
            </button>
            <button
              onClick={onEditDept}
              title="Edit department"
              className="text-[11px] opacity-0 transition hover:text-white/80 group-hover/dept:opacity-100 print:hidden"
            >
              ✎
            </button>
          </div>
        </td>
        {showDemand &&
          DAYS.map((d) => {
            const date = dateForDay(weekStart, d);
            return shownLocations.map((loc, locIdx) => {
              const closed = closureSet.has(`${loc.id}|${d}`);
              const count = agendaCountMap.get(`${dept.id}|${loc.id}|${date}`) ?? 0;
              return (
                <td
                  key={`demand-${d}-${loc.id}`}
                  className="px-1 py-1 text-center text-[11px] font-bold tabular-nums text-white/95"
                  style={{
                    background: dept.color,
                    width: closed ? 18 : COL_W,
                    minWidth: closed ? 18 : COL_W,
                    maxWidth: closed ? 18 : COL_W,
                    borderLeft:
                      locIdx === 0
                        ? "2px solid rgba(255,255,255,0.5)"
                        : "1px solid rgba(255,255,255,0.25)",
                  }}
                  title={
                    count > 0
                      ? `${count} appointment${count === 1 ? "" : "s"} booked — ${dept.name} @ ${loc.short_code ?? loc.name}`
                      : undefined
                  }
                >
                  {closed ? "" : count > 0 ? count : ""}
                </td>
              );
            });
          })}
      </tr>
      {children}
    </>
  );
}
