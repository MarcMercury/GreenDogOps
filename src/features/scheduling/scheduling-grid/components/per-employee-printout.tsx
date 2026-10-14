"use client";

import { formatWeekRange, gridName } from "@/lib/schedule/types";
import { formatClock } from "@/features/scheduling/scheduling-grid/lib/time-format";
import type { EmployeeSchedule } from "@/features/scheduling/scheduling-grid/types/grid";

/**
 * Per-employee printout: one page per employee, hidden on screen, revealed
 * only when the grid root carries the `sched-print-employee` class.
 */
export function PerEmployeePrintout({
  weekStart,
  employees,
}: {
  weekStart: string;
  employees: EmployeeSchedule[];
}) {
  const fmtDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="sched-employee-print">
      {employees.map(({ person, shifts }) => (
        <section key={person.id} className="sched-emp-page mb-8">
          <div className="mb-3 flex items-baseline justify-between border-b-2 border-slate-800 pb-2">
            <h2 className="text-xl font-bold text-slate-900">
              {gridName(person)}
            </h2>
            <span className="text-sm font-medium text-slate-600">
              Week of {formatWeekRange(weekStart)}
            </span>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-400 text-left">
                <th className="py-1.5 pr-4 font-semibold text-slate-700">Date</th>
                <th className="py-1.5 pr-4 font-semibold text-slate-700">
                  Start
                </th>
                <th className="py-1.5 pr-4 font-semibold text-slate-700">End</th>
                <th className="py-1.5 pr-4 font-semibold text-slate-700">
                  Position
                </th>
                <th className="py-1.5 font-semibold text-slate-700">Schedule</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s, i) => (
                <tr key={i} className="border-b border-slate-200">
                  <td className="py-1.5 pr-4">{fmtDate(s.date)}</td>
                  <td className="py-1.5 pr-4 font-mono">
                    {formatClock(s.start) || "—"}
                  </td>
                  <td className="py-1.5 pr-4 font-mono">
                    {formatClock(s.end) || "—"}
                  </td>
                  <td className="py-1.5 pr-4">{s.position}</td>
                  <td className="py-1.5">{s.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm font-semibold text-slate-700">
            Total shifts: {shifts.length}
          </p>
        </section>
      ))}
    </div>
  );
}
