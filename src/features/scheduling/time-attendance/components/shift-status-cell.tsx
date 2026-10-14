import { ATTENDANCE_LABELS } from "@/lib/schedule/types";
import { SHIFT_STATE_LABELS } from "@/lib/timeclock/attendance";
import { STATE_STYLE } from "@/features/scheduling/time-attendance/lib/state-style";
import type { GradedRow } from "@/features/scheduling/time-attendance/types/graded-row";

/**
 * The grade pill, plus whatever qualifies it: how late, how early they left,
 * a manager's manual mark (which always wins), and an off-site punch still
 * waiting for an approver.
 */
export function ShiftStatusCell({ row: r }: { row: GradedRow }) {
  return (
    <td className="py-2 pr-3">
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[r.state]}`}>
        {SHIFT_STATE_LABELS[r.state]}
      </span>
      {r.lateLevel ? (
        <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          {r.lateLevel === "very_late" ? "Very late" : "Late"} {r.lateMinutes} min
        </span>
      ) : null}
      {r.leftEarlyMinutes ? (
        <span className="ml-1 text-xs text-slate-500">{r.leftEarlyMinutes} min early</span>
      ) : null}
      {r.shift.manual_status !== "scheduled" ? (
        <span className="ml-1 text-xs text-slate-500">
          Marked: {ATTENDANCE_LABELS[r.shift.manual_status]}
        </span>
      ) : null}
      {r.session?.punches.some((p) => p.approval === "pending") ? (
        <span className="ml-1 text-xs text-amber-700">off-site, awaiting approval</span>
      ) : null}
    </td>
  );
}
