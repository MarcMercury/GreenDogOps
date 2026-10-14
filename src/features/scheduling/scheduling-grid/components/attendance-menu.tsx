"use client";

import { useState } from "react";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_TONE,
  MARKABLE_ATTENDANCE,
  effectiveAttendance,
  gridName,
  type AttendanceStatus,
  type SchedAssignment,
  type SchedPerson,
} from "@/lib/schedule/types";

/** Attendance marking menu for one published shift. */
export function AttendanceMenu({
  assignment,
  systemStatus,
  person,
  onClose,
  onMark,
}: {
  assignment: SchedAssignment;
  /** Time-clock grade when attendance is live and the shift is unmarked. */
  systemStatus?: AttendanceStatus;
  person: SchedPerson | undefined;
  onClose: () => void;
  onMark: (status: AttendanceStatus, note: string | null) => void;
}) {
  const [note, setNote] = useState(assignment.attendance_note ?? "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              {person ? gridName(person) : "Attendance"}
            </h3>
            <p className="text-xs text-slate-500">
              Current:{" "}
              <span className="font-medium">
                {ATTENDANCE_LABELS[effectiveAttendance(assignment, true, undefined, systemStatus)]}
              </span>
              {systemStatus && assignment.attendance_status === "scheduled" ? (
                <span className="text-slate-400"> · from the time clock</span>
              ) : null}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            {MARKABLE_ATTENDANCE.map((s) => (
              <button
                key={s}
                onClick={() => onMark(s, note.trim() || null)}
                className={`rounded-lg px-2 py-2 text-xs font-semibold ${ATTENDANCE_TONE[s]} ring-1 ring-inset ring-black/5 hover:opacity-80`}
              >
                {ATTENDANCE_LABELS[s]}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note…"
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={() => onMark("scheduled", note.trim() || null)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            Clear marking (assume Present)
          </button>
        </div>
      </div>
    </div>
  );
}
