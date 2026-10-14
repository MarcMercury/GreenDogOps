"use client";

import { DAY_LABELS, gridName } from "@/lib/schedule/types";
import type { PtoChip } from "@/features/scheduling/scheduling-grid/types/grid";

/** Approve / deny a PTO request from the grid's time-off section. */
export function PtoDecisionMenu({
  chip,
  day,
  onClose,
  onDecide,
}: {
  chip: PtoChip;
  day: number;
  onClose: () => void;
  onDecide: (status: "approved" | "denied") => void;
}) {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  const range =
    chip.startDate === chip.endDate
      ? fmt(chip.startDate)
      : `${fmt(chip.startDate)} – ${fmt(chip.endDate)}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              {gridName(chip.person)}
            </h3>
            <p className="text-xs text-slate-500">
              Time-off request · {range} ·{" "}
              <span
                className={`font-medium ${
                  chip.status === "approved"
                    ? "text-emerald-600"
                    : "text-amber-600"
                }`}
              >
                {chip.status === "approved" ? "Approved" : "Pending"}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <div className="space-y-2 p-4">
          <p className="text-xs text-slate-500">
            Affects the whole request ({range}), not just {DAY_LABELS[day]}.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onDecide("approved")}
              disabled={chip.status === "approved"}
              className="rounded-lg bg-emerald-100 px-2 py-2 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Approve
            </button>
            <button
              onClick={() => onDecide("denied")}
              className="rounded-lg bg-red-100 px-2 py-2 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200 hover:opacity-80"
            >
              Deny
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Denying removes the time off and frees {gridName(chip.person)} to be
            scheduled those days.
          </p>
        </div>
      </div>
    </div>
  );
}
