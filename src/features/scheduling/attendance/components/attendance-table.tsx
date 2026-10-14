"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { reliabilityTone } from "@/lib/schedule/types";
import { AttendanceFilters } from "@/features/scheduling/attendance/components/attendance-filters";
import { AttendanceSortHeader } from "@/features/scheduling/attendance/components/attendance-sort-header";
import { AttendanceTotalsGrid } from "@/features/scheduling/attendance/components/attendance-totals-grid";
import { COLUMNS } from "@/features/scheduling/attendance/lib/attendance-columns";
import { filterAndSortEmployees } from "@/features/scheduling/attendance/lib/filter-sort";
import { attendanceTotals } from "@/features/scheduling/attendance/lib/totals";
import type { SortDir, SortKey } from "@/features/scheduling/attendance/types/attendance-sort";
import type { EmployeeAttendance } from "@/features/scheduling/attendance/types/employee-attendance";

/** The Attendance & Reliability table: company totals, filters, and one sortable row per employee. */
export function AttendanceTable({
  employees,
}: {
  employees: EmployeeAttendance[];
}) {
  const [q, setQ] = useState("");
  const [onlyResolved, setOnlyResolved] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Text sorts default ascending; numeric columns default descending.
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const filtered = useMemo(
    () => filterAndSortEmployees(employees, { query: q, onlyResolved, sortKey, sortDir }),
    [employees, q, onlyResolved, sortKey, sortDir],
  );

  const totals = useMemo(() => attendanceTotals(employees), [employees]);

  return (
    <div className="space-y-4">
      <AttendanceTotalsGrid totals={totals} />

      <AttendanceFilters
        query={q}
        onQueryChange={setQ}
        onlyResolved={onlyResolved}
        onOnlyResolvedChange={setOnlyResolved}
      />

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-400">
              <AttendanceSortHeader
                label="Employee"
                active={sortKey === "name"}
                dir={sortDir}
                onClick={() => toggleSort("name")}
              />
              <AttendanceSortHeader
                label="Reliability"
                align="center"
                active={sortKey === "score"}
                dir={sortDir}
                onClick={() => toggleSort("score")}
              />
              {COLUMNS.map((c) => (
                <AttendanceSortHeader
                  key={c.key}
                  label={c.label}
                  align="center"
                  active={sortKey === c.key}
                  dir={sortDir}
                  onClick={() => toggleSort(c.key)}
                />
              ))}
              <AttendanceSortHeader
                label="Resolved"
                align="center"
                active={sortKey === "total"}
                dir={sortDir}
                onClick={() => toggleSort("total")}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filtered.map((e) => (
              <tr key={e.personId} className="hover:bg-slate-50/50">
                <td className="px-3 py-2 font-medium text-slate-800">
                  <Link
                    href={`/hr/${e.personId}`}
                    className="text-slate-800 hover:text-emerald-700 hover:underline"
                    title="Open HR profile"
                  >
                    {e.name}
                  </Link>
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
