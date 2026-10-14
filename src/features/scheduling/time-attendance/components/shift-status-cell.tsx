"use client";

import { Badge } from "@/components/ui/badge";
import { TableCell } from "@/components/ui/table";
import { ATTENDANCE_LABELS } from "@/lib/schedule/types";
import { SHIFT_STATE_LABELS } from "@/lib/timeclock/attendance";
import { STATE_STYLE } from "@/features/scheduling/time-attendance/lib/state-style";
import type { GradedRow } from "@/features/scheduling/time-attendance/types/graded-row";

/**
 * The grade pill, plus whatever qualifies it: how late, how early they left,
 * a manager's manual mark (which always wins), and an off-site punch still
 * waiting for an approver.
 *
 * A client component only because shadcn's `Badge` renders through a Base UI
 * hook; everything it shows arrives as plain props from the server table.
 */
export function ShiftStatusCell({ row: r }: { row: GradedRow }) {
  return (
    <TableCell className="px-0 pr-3 whitespace-normal">
      <Badge variant="secondary" className={STATE_STYLE[r.state]}>
        {SHIFT_STATE_LABELS[r.state]}
      </Badge>
      {r.lateLevel ? (
        <Badge variant="secondary" className="ml-1 bg-amber-50 text-amber-800">
          {r.lateLevel === "very_late" ? "Very late" : "Late"} {r.lateMinutes} min
        </Badge>
      ) : null}
      {r.leftEarlyMinutes ? (
        <span className="ml-1 text-xs text-muted-foreground">{r.leftEarlyMinutes} min early</span>
      ) : null}
      {r.shift.manual_status !== "scheduled" ? (
        <span className="ml-1 text-xs text-muted-foreground">
          Marked: {ATTENDANCE_LABELS[r.shift.manual_status]}
        </span>
      ) : null}
      {r.session?.punches.some((p) => p.approval === "pending") ? (
        <span className="ml-1 text-xs text-amber-700">off-site, awaiting approval</span>
      ) : null}
    </TableCell>
  );
}
