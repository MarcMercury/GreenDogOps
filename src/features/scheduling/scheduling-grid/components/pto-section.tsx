"use client";

import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import { DAY_LABELS, gridName } from "@/lib/schedule/types";
import { CollapsibleCellContent } from "@/features/scheduling/scheduling-grid/components/grid/collapsible-cell-content";
import styles from "@/features/scheduling/scheduling-grid/components/grid/grid.module.css";
import type { SectionState } from "@/features/scheduling/scheduling-grid/hooks/use-section-transitions";
import { tintOf } from "@/features/scheduling/scheduling-grid/lib/color";
import { DAYS, PTO_COLOR } from "@/features/scheduling/scheduling-grid/lib/grid-constants";
import type { PtoChip } from "@/features/scheduling/scheduling-grid/types/grid";

/**
 * Time-off overview — a collapsible "PTO" section pinned to the top of the
 * grid, styled like a department section. Per day it lists everyone off,
 * amber (pending) or emerald (approved), so the schedule admin sees who is
 * already cleared to be off.
 */
export function PtoSection({
  colCount,
  span,
  collapsed,
  state,
  ptoByDay,
  weekCount,
  canEdit,
  onToggle,
  onDecide,
}: {
  colCount: number;
  span: number;
  collapsed: boolean;
  /** open / opening / closing, for the body row's animation. */
  state: SectionState;
  ptoByDay: Map<number, PtoChip[]>;
  weekCount: number;
  canEdit: boolean;
  onToggle: () => void;
  onDecide: (chip: PtoChip, day: number) => void;
}) {
  const showCols = colCount > 0;
  const tint = tintOf(PTO_COLOR, 0.12);
  const pill = tintOf(PTO_COLOR, 0.28);
  // The body stays mounted while it animates closed.
  const showBody = !collapsed || state === "closing";
  return (
    <>
      <tr style={{ backgroundColor: tint }}>
        <td
          colSpan={showCols ? 1 : span}
          className="sticky left-0 z-10 border-b border-slate-200/70 px-3 py-1.5"
          style={{ backgroundColor: tint }}
        >
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            className="flex w-full items-center gap-2 text-left text-[11px] font-bold uppercase tracking-wider hover:opacity-80"
            style={{ color: PTO_COLOR }}
          >
            {collapsed ? (
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: PTO_COLOR }} aria-hidden />
            ) : (
              <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden />
            )}
            <span>PTO</span>
            {weekCount > 0 && (
              <span className="rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums" style={{ backgroundColor: pill }}>
                {weekCount}
              </span>
            )}
          </button>
        </td>
        {showCols &&
          DAYS.map((d) => {
            const n = ptoByDay.get(d)?.length ?? 0;
            return (
              <td
                key={`pto-h-${d}`}
                colSpan={colCount}
                className="border-b border-l-2 border-b-slate-200/70 border-l-slate-300 px-1 py-1 text-center text-[11px] font-bold tabular-nums"
                style={{ color: PTO_COLOR }}
                title={n > 0 ? `${n} off ${DAY_LABELS[d]}` : undefined}
              >
                {n > 0 ? n : ""}
              </td>
            );
          })}
      </tr>
      {showBody && (
        <tr data-collapse={state} className={cn("bg-violet-50/40", styles.row)}>
          <th
            scope="row"
            className="sticky left-0 z-10 border-b border-r border-slate-200 bg-violet-50 px-3 py-2 text-left align-top text-[11px] font-semibold text-violet-700"
            style={{ borderLeft: `3px solid ${PTO_COLOR}` }}
          >
            <CollapsibleCellContent>Time off</CollapsibleCellContent>
          </th>
          {showCols ? (
            DAYS.map((d) => {
              const list = ptoByDay.get(d) ?? [];
              return (
                <td
                  key={`pto-b-${d}`}
                  colSpan={colCount}
                  className="border-b border-l-2 border-b-slate-200 border-l-slate-300 p-1 align-top"
                >
                  <CollapsibleCellContent>
                    {list.length === 0 ? (
                      <span className="text-[11px] text-slate-300">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {list.map((chip) => {
                          const { person, status, requestId } = chip;
                          const tone =
                            status === "approved"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700";
                          const label = gridName(person);
                          if (!canEdit) {
                            return (
                              <span
                                key={requestId}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}
                                title={status === "approved" ? "Approved time off" : "Pending time-off request"}
                              >
                                {label}
                              </span>
                            );
                          }
                          return (
                            <button
                              key={requestId}
                              type="button"
                              onClick={() => onDecide(chip, d)}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ring-black/5 transition hover:opacity-80 ${tone} ${
                                status === "requested" ? "ring-amber-400" : ""
                              }`}
                              title={
                                status === "approved"
                                  ? "Approved — click to review or deny"
                                  : "Pending request — click to approve or deny"
                              }
                            >
                              {label}
                              {status === "requested" && (
                                <span aria-hidden className="ml-0.5 opacity-70">
                                  •
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </CollapsibleCellContent>
                </td>
              );
            })
          ) : (
            <td className="border-b border-l-2 border-b-slate-200 border-l-slate-300 bg-slate-50/40" />
          )}
        </tr>
      )}
    </>
  );
}
