import type { EmployeePeriod } from "@/lib/payroll/server";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <Card className="py-0">
      {rows.length === 0 ? (
        <CardContent className="py-6">
          <Empty className="border py-6">
            <EmptyHeader>
              <EmptyTitle>No time-clock punches in this pay period.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </CardContent>
      ) : (
        <Table>
          <TableHeader className="text-xs text-muted-foreground">
            <TableRow>
              <TableHead className="px-4">Employee</TableHead>
              <TableHead className="text-right">Regular</TableHead>
              <TableHead className="text-right">OT 1.5x</TableHead>
              <TableHead className="text-right">DT 2x</TableHead>
              <TableHead className="text-right">Meal prem.</TableHead>
              <TableHead className="text-right">Rest prem.</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead className="px-4 text-right">Approval</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TimecardRow key={r.person_id} row={r} periodStart={periodStart} open={open} currentPersonId={currentPersonId} />
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
