import type { EmployeePeriod } from "@/lib/payroll/server";
import { TimecardRow } from "@/features/scheduling/payroll/components/timecard-row";

/** Every employee with time in the period, one row each; an empty state when nobody punched. */
export function TimecardTable({
  rows,
  periodStart,
  open,
  currentPersonId,
}: {
  rows: EmployeePeriod[];
  periodStart: string;
  open: boolean;
  currentPersonId: string | null;
}) {
  return (
    <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-slate-500">No time-clock punches in this pay period.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Employee</th>
              <th className="px-2 py-2 text-right font-medium">Regular</th>
              <th className="px-2 py-2 text-right font-medium">OT 1.5x</th>
              <th className="px-2 py-2 text-right font-medium">DT 2x</th>
              <th className="px-2 py-2 text-right font-medium">Meal prem.</th>
              <th className="px-2 py-2 text-right font-medium">Rest prem.</th>
              <th className="px-2 py-2 font-medium">Flags</th>
              <th className="px-4 py-2 text-right font-medium">Approval</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <TimecardRow key={r.person_id} row={r} periodStart={periodStart} open={open} currentPersonId={currentPersonId} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
