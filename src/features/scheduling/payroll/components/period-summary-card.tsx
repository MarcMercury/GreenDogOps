import { cn } from "cn";
import type { EmployeePeriod, PayPeriodRow } from "@/lib/payroll/server";
import { shortDateLabel } from "@/lib/worklist/dates";
import { badgeVariants } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExportCsvForm } from "@/features/scheduling/payroll/components/export-csv-form";
import { HoursTotals } from "@/features/scheduling/payroll/components/hours-totals";
import { LockButton } from "@/features/scheduling/payroll/components/lock-button";
import { ReopenButton } from "@/features/scheduling/payroll/components/reopen-button";
import { approvedCount, missingRunIdCount, unknownFlsaCount } from "@/features/scheduling/payroll/lib/period-summary";
import { STATUS_STYLE } from "@/features/scheduling/payroll/lib/status-style";

/**
 * The period's header card: its dates and pay date, status, how many timecards
 * are approved, the lock / export / reopen controls, the hours totals, and the
 * note on what the export is (and is not yet).
 */
export function PeriodSummaryCard({
  period,
  rows,
  blockers,
  canReopen,
}: {
  period: PayPeriodRow;
  rows: EmployeePeriod[];
  /** Why the period cannot be locked yet (`lockBlockers`); empty when it can. */
  blockers: string[];
  /** Owner/Admin only: reopening a locked period. */
  canReopen: boolean;
}) {
  const open = period.status === "open";
  const approved = approvedCount(rows);
  const missingRunId = missingRunIdCount(rows);
  const unknownFlsa = unknownFlsaCount(rows);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {shortDateLabel(period.period_start)} – {shortDateLabel(period.period_end)} · paid {shortDateLabel(period.pay_date)}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          {/* Server component: the badge's classes on a span, not <Badge> (Base UI hooks). */}
          <span className={cn(badgeVariants({ variant: "outline" }), "capitalize", STATUS_STYLE[period.status])}>
            {period.status}
          </span>
          <span className="text-xs">
            {approved} of {rows.length} timecards approved
          </span>
        </CardDescription>
        <CardAction className="flex flex-wrap items-center gap-2">
          {open ? <LockButton period={period.period_start} blockers={blockers} /> : null}
          {!open ? <ExportCsvForm periodStart={period.period_start} /> : null}
          {!open && canReopen ? <ReopenButton period={period.period_start} /> : null}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {open && blockers.length ? <p className="text-xs text-muted-foreground">To lock: {blockers.join(" ")}</p> : null}
        <HoursTotals rows={rows} />
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          The export is Ops&apos; timecard totals, not yet the ADP RUN import file — that layout is added once the When I
          Work → RUN header row and RUN&apos;s meal / rest premium pay codes are provided (go-live items 19–20).
          {missingRunId ? ` ${missingRunId} employee(s) here have no ADP RUN Employee ID yet.` : ""}
          {unknownFlsa ? ` ${unknownFlsa} have no FLSA status (treated as non-exempt).` : ""}
        </p>
      </CardContent>
    </Card>
  );
}
