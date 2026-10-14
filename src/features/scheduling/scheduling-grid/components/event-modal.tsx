"use client";

import { useState } from "react";
import { dateForDay, type ScheduleLocation } from "@/lib/schedule/types";

/** Add or edit a per-location/day event banner. */
export function EventModal({
  location,
  day,
  weekStart,
  initial,
  onClose,
  onSave,
}: {
  location: ScheduleLocation;
  day: number;
  weekStart: string;
  initial: string;
  onClose: () => void;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(initial);
  const dateLabel = new Date(
    `${dateForDay(weekStart, day)}T00:00:00`,
  ).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: location.color ?? "#64748b" }}
            />
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Event · {location.name}
              </h3>
              <p className="text-xs text-slate-500">{dateLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <div className="space-y-3 p-4">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(title);
            }}
            placeholder="e.g. Full Team Meeting, Adoption Event…"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <div className="flex justify-between gap-2 pt-1">
            <button
              onClick={() => onSave("")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              Clear
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => onSave(title)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
