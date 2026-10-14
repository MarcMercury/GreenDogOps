"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        <Table className="min-w-full">
          <TableHeader>
            <TableRow className="bg-muted/50 text-xs hover:bg-muted/50">
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e) => (
              <TableRow key={e.personId}>
                <TableCell className="px-3 font-medium text-foreground">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Link
                          href={`/hr/${e.personId}`}
                          className="text-foreground hover:text-emerald-700 hover:underline"
                        />
                      }
                    >
                      {e.name}
                    </TooltipTrigger>
                    <TooltipContent>Open HR profile</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="px-3 text-center">
                  <span className={`text-sm font-bold ${reliabilityTone(e.score)}`}>
                    {e.score == null ? "—" : `${e.score}%`}
                  </span>
                </TableCell>
                {COLUMNS.map((c) => {
                  const v = e.tally[c.key];
                  return (
                    <TableCell
                      key={c.key}
                      className={`px-3 text-center ${v ? c.tone : "text-muted-foreground/50"}`}
                    >
                      {v || "·"}
                    </TableCell>
                  );
                })}
                <TableCell className="px-3 text-center text-muted-foreground">
                  {e.tally.total}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={COLUMNS.length + 3} className="whitespace-normal p-0">
                  <Empty className="py-10">
                    <EmptyHeader>
                      <EmptyDescription>
                        No attendance recorded yet. Mark attendance from a published grid.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
