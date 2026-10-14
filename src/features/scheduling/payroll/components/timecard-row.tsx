import Link from "next/link";
import { cn } from "cn";
import type { EmployeePeriod } from "@/lib/payroll/server";
import { badgeVariants } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { ApproveButton } from "@/features/scheduling/payroll/components/approve-button";
import { TimecardDayList } from "@/features/scheduling/payroll/components/timecard-day-list";
import { formatHours } from "@/features/scheduling/payroll/lib/hours";
import { isApproved } from "@/features/scheduling/payroll/lib/period-summary";

/** One employee's line: FLSA and RUN ID, the per-day breakdown, hours, premiums, flags and approval. */
export function TimecardRow({
  row: r,
  periodStart,
  open,
  currentPersonId,
}: {
  row: EmployeePeriod;
  periodStart: string;
  /** Approvals can only change while the period is open. */
  open: boolean;
  /** The viewer's own person id — nobody approves their own timecard. */
  currentPersonId: string | null;
}) {
  const mealDays = r.result.days.filter((d) => d.mealPremium);
  const own = currentPersonId === r.person_id;
  return (
    <TableRow className="align-top">
      <TableCell className="px-4 align-top whitespace-normal">
        <span className="font-medium text-foreground">{r.name}</span>
        <span className="block text-xs text-muted-foreground">
          {r.flsa === "exempt" ? "Exempt" : r.flsa === "non_exempt" ? "Non-exempt" : "FLSA unknown"} · RUN ID{" "}
          {r.adp_employee_id ?? <span className="text-amber-700">missing</span>}
        </span>
        <TimecardDayList days={r.result.days} />
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">{formatHours(r.result.totals.regular)}</TableCell>
      <TableCell className="text-right align-top tabular-nums">{formatHours(r.result.totals.overtime)}</TableCell>
      <TableCell className="text-right align-top tabular-nums">{formatHours(r.result.totals.doubleTime)}</TableCell>
      <TableCell className="text-right align-top tabular-nums" title={mealDays.map((d) => d.work_date).join(", ")}>
        {r.result.totals.mealPremiums}
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">{r.result.totals.restPremiums}</TableCell>
      <TableCell className="align-top text-xs whitespace-normal">
        {r.blockers.length ? (
          <span className="text-destructive">
            {r.blockers.join("; ")} —{" "}
            <Link href="/schedule/time-clock" className="underline">
              fix in Time Clock
            </Link>
          </span>
        ) : r.approval?.stale ? (
          // Server component: the badge's classes on a span, not <Badge> (Base UI hooks).
          <span className={cn(badgeVariants({ variant: "outline" }), "text-amber-700")}>Changed since approval</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="px-4 text-right align-top text-xs text-muted-foreground">
        {isApproved(r) ? (
          <span className="block">
            ✓ {r.approval.approved_by_name ?? "Approved"}
          </span>
        ) : null}
        {open ? (
          <ApproveButton
            period={periodStart}
            personId={r.person_id}
            approved={isApproved(r)}
            disabled={r.blockers.length > 0 || own}
            title={own ? "You can't approve your own timecard" : r.blockers.join("; ")}
          />
        ) : null}
      </TableCell>
    </TableRow>
  );
}
