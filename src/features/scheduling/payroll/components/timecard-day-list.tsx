import { MEAL_ISSUE_LABELS, type DayResult } from "@/lib/payroll/ca-rules";
import { shortDateLabel } from "@/lib/worklist/dates";
import { formatHours } from "@/features/scheduling/payroll/lib/hours";

/** Collapsed per-day breakdown under an employee's name: hours by bucket plus each day's flags. */
export function TimecardDayList({ days }: { days: DayResult[] }) {
  return (
    <details className="mt-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer">{days.length} day(s)</summary>
      <ul className="mt-1 space-y-0.5">
        {days.map((d) => (
          <li key={d.work_date}>
            {shortDateLabel(d.work_date)}: {formatHours(d.worked)} h (reg {formatHours(d.regular)}, OT {formatHours(d.overtime)}, DT {formatHours(d.doubleTime)})
            {d.seventhDay ? " · 7th day" : ""}
            {d.mealPremium && d.mealIssue ? ` · meal: ${MEAL_ISSUE_LABELS[d.mealIssue]}` : ""}
            {d.mealWaived ? " · meal waived" : ""}
            {d.restPremium ? " · rest breaks missed" : ""}
            {d.incomplete ? " · missing punch" : ""}
            {d.pendingApproval ? " · off-site pending" : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}
