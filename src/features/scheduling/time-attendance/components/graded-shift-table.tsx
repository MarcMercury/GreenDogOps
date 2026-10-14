import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration } from "@/lib/timeclock/timecard";
import { shiftTime } from "@/features/scheduling/time-attendance/lib/shift-time";
import { t } from "@/features/scheduling/time-attendance/server/format-clock";
import type { GradedRow } from "@/features/scheduling/time-attendance/types/graded-row";
import { ShiftStatusCell } from "@/features/scheduling/time-attendance/components/shift-status-cell";

/** Every shift at one clinic that day — who, when, how it was graded, and the punches behind it. */
export function GradedShiftTable({ rows }: { rows: GradedRow[] }) {
  return (
    <div className="mt-4">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 px-0 pr-3 text-xs text-muted-foreground">Employee</TableHead>
            <TableHead className="h-8 px-0 pr-3 text-xs text-muted-foreground">Shift</TableHead>
            <TableHead className="h-8 px-0 pr-3 text-xs text-muted-foreground">Status</TableHead>
            <TableHead className="h-8 px-0 pr-3 text-xs text-muted-foreground">In</TableHead>
            <TableHead className="h-8 px-0 pr-3 text-xs text-muted-foreground">Out</TableHead>
            <TableHead className="h-8 px-0 text-xs text-muted-foreground">Worked</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.shift.assignment_id}>
              <TableCell className="px-0 pr-3 text-foreground">
                {r.shift.person_name}
                <span className="block text-xs text-muted-foreground">
                  {[r.shift.role, r.shift.label].filter(Boolean).join(" · ")}
                </span>
              </TableCell>
              <TableCell className="px-0 pr-3 text-muted-foreground">{shiftTime(r.shift)}</TableCell>
              <ShiftStatusCell row={r} />
              <TableCell className="px-0 pr-3 tabular-nums">{t(r.session?.clock_in)}</TableCell>
              <TableCell className="px-0 pr-3 tabular-nums">{t(r.session?.clock_out)}</TableCell>
              <TableCell className="px-0 tabular-nums">
                {r.session?.worked_ms != null ? formatDuration(r.session.worked_ms) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
