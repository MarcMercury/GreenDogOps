"use client";

import { DAY_LABELS, gridName } from "@/lib/schedule/types";
import { DAYS } from "@/features/scheduling/scheduling-grid/lib/grid-constants";
import type { PtoChip } from "@/features/scheduling/scheduling-grid/types/grid";

/**
 * Time-off overview — a collapsible "PTO" section pinned to the top of the
 * grid. Per day it lists everyone off, colored amber (pending) or emerald
 * (approved) so the schedule admin sees who is already cleared to be off.
 */
export function PtoSection({
  colCount,
  span,
  collapsed,
  ptoByDay,
  weekCount,
  canEdit,
  onToggle,
  onDecide,
}: {
  colCount: number;
  span: number;
  collapsed: boolean;
  ptoByDay: Map<number, PtoChip[]>;
  weekCount: number;
  canEdit: boolean;
  onToggle: () => void;
  onDecide: (chip: PtoChip, day: number) => void;
}) {
  const showCols = colCount > 0;
  const BG = "#6d28d9"; // violet-700 — distinct from department colors.
  return (
    <>
      <tr>
        <td
          colSpan={showCols ? 1 : span}
          className="sticky left-0 z-10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white"
          style={{ background: BG }}
        >
          <button
            onClick={onToggle}
            title={collapsed ? "Expand time off" : "Collapse time off"}
            aria-expanded={!collapsed}
            className="flex w-full items-center gap-1.5 text-left hover:text-white/90"
          >
            <span
              className={`inline-block text-[9px] transition-transform ${
                collapsed ? "-rotate-90" : ""
              }`}
            >
              ▼
            </span>
            <span>PTO</span>
            {weekCount > 0 && (
              <span className="rounded bg-white/20 px-1.5 text-[9px] font-semibold">
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
                className="border-l-2 border-l-white/40 px-1 py-1 text-center text-[11px] font-bold tabular-nums text-white/95"
                style={{ background: BG }}
                title={n > 0 ? `${n} off ${DAY_LABELS[d]}` : undefined}
              >
                {n > 0 ? n : ""}
              </td>
            );
          })}
      </tr>
      {!collapsed && (
        <tr className="bg-violet-50/60">
          <th
            scope="row"
            className="sticky left-0 z-10 border-b border-r border-slate-300 bg-violet-50 px-3 py-1.5 text-left align-top text-[11px] font-semibold text-violet-700"
            style={{ borderLeft: `3px solid ${BG}` }}
          >
            Time off
          </th>
          {showCols ? (
            DAYS.map((d) => {
              const list = ptoByDay.get(d) ?? [];
              return (
                <td
                  key={`pto-b-${d}`}
                  colSpan={colCount}
                  className="border-b border-l-2 border-b-slate-200 border-l-slate-400 p-1 align-top"
                >
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
                              title={
                                status === "approved"
                                  ? "Approved time off"
                                  : "Pending time-off request"
                              }
                            >
                              {label}
                            </span>
                          );
                        }
                        return (
                          <button
                            key={requestId}
                            onClick={() => onDecide(chip, d)}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ring-black/5 transition hover:opacity-80 ${tone} ${
                              status === "requested"
                                ? "ring-amber-400"
                                : ""
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
                </td>
              );
            })
          ) : (
            <td className="border-b border-l-2 border-b-slate-200 border-l-slate-400 bg-slate-50/40" />
          )}
        </tr>
      )}
    </>
  );
}
