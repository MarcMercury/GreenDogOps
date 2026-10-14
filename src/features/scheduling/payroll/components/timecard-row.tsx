import Link from "next/link";
import type { EmployeePeriod } from "@/lib/payroll/server";
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
    <tr className="align-top">
      <td className="px-4 py-2">
        <span className="font-medium text-slate-800">{r.name}</span>
        <span className="block text-xs text-slate-400">
          {r.flsa === "exempt" ? "Exempt" : r.flsa === "non_exempt" ? "Non-exempt" : "FLSA unknown"} · RUN ID{" "}
          {r.adp_employee_id ?? <span className="text-amber-700">missing</span>}
        </span>
        <TimecardDayList days={r.result.days} />
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{formatHours(r.result.totals.regular)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatHours(r.result.totals.overtime)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatHours(r.result.totals.doubleTime)}</td>
      <td className="px-2 py-2 text-right tabular-nums" title={mealDays.map((d) => d.work_date).join(", ")}>
        {r.result.totals.mealPremiums}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{r.result.totals.restPremiums}</td>
      <td className="px-2 py-2 text-xs">
        {r.blockers.length ? (
          <span className="text-red-700">
            {r.blockers.join("; ")} —{" "}
            <Link href="/schedule/time-clock" className="underline">
              fix in Time Clock
            </Link>
          </span>
        ) : r.approval?.stale ? (
          <span className="text-amber-700">Changed since approval</span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-4 py-2 text-right text-xs text-slate-500">
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
      </td>
    </tr>
  );
}
