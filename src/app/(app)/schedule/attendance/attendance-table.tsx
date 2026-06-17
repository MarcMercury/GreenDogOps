"use client";

import { useMemo, useState } from "react";
import {
  reliabilityTone,
  type ReliabilityTally,
} from "@/lib/schedule/types";

export interface EmployeeAttendance {
  personId: string;
  name: string;
  tally: ReliabilityTally;
  score: number | null;
}

const COLUMNS: {
  key: keyof ReliabilityTally;
  label: string;
  tone: string;
}[] = [
  { key: "present", label: "Present", tone: "text-emerald-600" },
  { key: "late", label: "Late", tone: "text-amber-600" },
  { key: "late_excused", label: "Late (Exc)", tone: "text-amber-500" },
  { key: "absent", label: "Absent", tone: "text-red-600" },
  { key: "absent_excused", label: "Absent (Exc)", tone: "text-orange-500" },
  { key: "no_show", label: "No Show", tone: "text-red-700" },
  { key: "pto", label: "PTO", tone: "text-violet-600" },
];

export function AttendanceTable({
  employees,
}: {
  employees: EmployeeAttendance[];
}) {
  const [q, setQ] = useState("");
  const [onlyResolved, setOnlyResolved] = useState(false);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return employees.filter((e) => {
      if (onlyResolved && e.tally.total === 0) return false;
      if (term && !e.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [employees, q, onlyResolved]);

  const totals = useMemo(() => {
    const acc = {
      present: 0,
      late: 0,
      absent: 0,
      no_show: 0,
    };
    for (const e of employees) {
      acc.present += e.tally.present;
      acc.late += e.tally.late + e.tally.late_excused;
      acc.absent += e.tally.absent + e.tally.absent_excused;
      acc.no_show += e.tally.no_show;
    }
    return acc;
  }, [employees]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Present" value={totals.present} tone="text-emerald-600" />
        <Stat label="Late" value={totals.late} tone="text-amber-600" />
        <Stat label="Absent" value={totals.absent} tone="text-red-600" />
        <Stat label="No-show" value={totals.no_show} tone="text-red-700" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search employees…"
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={onlyResolved}
            onChange={(e) => setOnlyResolved(e.target.checked)}
          />
          Only with recorded attendance
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-400">
              <th className="px-3 py-2 font-medium">Employee</th>
              <th className="px-3 py-2 text-center font-medium">Reliability</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2 text-center font-medium">
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2 text-center font-medium">Resolved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((e) => (
              <tr key={e.personId} className="hover:bg-slate-50/50">
                <td className="px-3 py-2 font-medium text-slate-800">
                  {e.name}
                </td>
                <td className="px-3 py-2 text-center">
                  <span
                    className={`text-sm font-bold ${reliabilityTone(e.score)}`}
                  >
                    {e.score == null ? "—" : `${e.score}%`}
                  </span>
                </td>
                {COLUMNS.map((c) => {
                  const v = e.tally[c.key];
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2 text-center ${
                        v ? c.tone : "text-slate-300"
                      }`}
                    >
                      {v || "·"}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center text-slate-500">
                  {e.tally.total}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length + 3}
                  className="px-3 py-10 text-center text-sm text-slate-400"
                >
                  No attendance recorded yet. Mark attendance from a published
                  grid.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}
