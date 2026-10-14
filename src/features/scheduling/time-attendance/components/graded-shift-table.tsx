import { formatDuration } from "@/lib/timeclock/timecard";
import { shiftTime } from "@/features/scheduling/time-attendance/lib/shift-time";
import { t } from "@/features/scheduling/time-attendance/server/format-clock";
import type { GradedRow } from "@/features/scheduling/time-attendance/types/graded-row";
import { ShiftStatusCell } from "@/features/scheduling/time-attendance/components/shift-status-cell";

/** Every shift at one clinic that day — who, when, how it was graded, and the punches behind it. */
export function GradedShiftTable({ rows }: { rows: GradedRow[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-400">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Employee</th>
            <th className="py-1.5 pr-3 font-medium">Shift</th>
            <th className="py-1.5 pr-3 font-medium">Status</th>
            <th className="py-1.5 pr-3 font-medium">In</th>
            <th className="py-1.5 pr-3 font-medium">Out</th>
            <th className="py-1.5 font-medium">Worked</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.shift.assignment_id}>
              <td className="py-2 pr-3 text-slate-800">
                {r.shift.person_name}
                <span className="block text-xs text-slate-400">
                  {[r.shift.role, r.shift.label].filter(Boolean).join(" · ")}
                </span>
              </td>
              <td className="py-2 pr-3 text-slate-600">{shiftTime(r.shift)}</td>
              <ShiftStatusCell row={r} />
              <td className="py-2 pr-3 tabular-nums text-slate-700">{t(r.session?.clock_in)}</td>
              <td className="py-2 pr-3 tabular-nums text-slate-700">{t(r.session?.clock_out)}</td>
              <td className="py-2 tabular-nums text-slate-700">
                {r.session?.worked_ms != null ? formatDuration(r.session.worked_ms) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
