import { SCHEDULE_STATUS_LABELS } from "@/lib/schedule/types";
import { WeekStatusDot } from "@/features/scheduling/scheduling-grid/components/sidebar/week-status-dot";
import { WEEK_STATUS_LEGEND } from "@/features/scheduling/scheduling-grid/lib/week-status-style";

/** What the calendar's dots mean. */
export function WeekStatusLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-xs text-slate-600">
      {WEEK_STATUS_LEGEND.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <WeekStatusDot status={status} />
          {status === "pending_approval" ? "Pending" : SCHEDULE_STATUS_LABELS[status]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <WeekStatusDot status={null} />
        Not created
      </li>
    </ul>
  );
}
