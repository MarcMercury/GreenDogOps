import { getCurrentUser } from "@/lib/auth/session";
import { canApproveTime, isAdminRole } from "@/lib/auth/permissions";
import { todayInWorkTz } from "@/lib/worklist/dates";
import { recentPayPeriods } from "@/lib/timeclock/pay-period";
import { lockBlockers } from "@/lib/payroll/period";
import { ensurePayPeriod, loadPeriodTimecards } from "@/lib/payroll/server";
import { RestrictedNotice } from "@/features/scheduling/shared/components/restricted-notice";
import { getPayrollExports } from "@/features/scheduling/payroll/db/get-payroll-exports";
import { selectPayPeriod } from "@/features/scheduling/payroll/lib/select-pay-period";
import { ExportHistory } from "@/features/scheduling/payroll/components/export-history";
import { PayPeriodNav } from "@/features/scheduling/payroll/components/pay-period-nav";
import { PeriodSummaryCard } from "@/features/scheduling/payroll/components/period-summary-card";
import { TimecardTable } from "@/features/scheduling/payroll/components/timecard-table";
import { PageHeader } from "../../_components/ui";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const current = await getCurrentUser({ allowPreview: true });
  if (!current || !canApproveTime(current.appUser)) {
    return (
      <RestrictedNotice>
        Payroll is for timecard approvers: Owner, Admin, Executive and HR / Manager.
      </RestrictedNotice>
    );
  }
  const { period: periodParam } = await searchParams;
  const today = todayInWorkTz();
  const periods = recentPayPeriods(today, 6);
  const period = await ensurePayPeriod(selectPayPeriod(periodParam, periods));
  const [rows, exports] = await Promise.all([loadPeriodTimecards(period), getPayrollExports(period.id)]);
  const blockers = lockBlockers(rows, period.period_end, today);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Payroll"
        description="Approve each timecard, lock the pay period, then export. Hours follow California rules: daily overtime over 8 h, double time over 12 h, weekly overtime over 40 h, the 7th-day rule, and meal / rest premiums."
      />

      <PayPeriodNav periods={periods} selectedStart={period.period_start} />

      <PeriodSummaryCard
        period={period}
        rows={rows}
        blockers={blockers}
        canReopen={isAdminRole(current.appUser.role)}
      />

      <TimecardTable
        rows={rows}
        periodStart={period.period_start}
        open={period.status === "open"}
        currentPersonId={current.appUser.person_id}
      />

      <ExportHistory exports={exports} />
    </div>
  );
}
