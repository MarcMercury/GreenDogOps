import type { UnscheduledWork as UnscheduledWorkItem } from "@/lib/timeclock/attendance-server";
import { formatDuration } from "@/lib/timeclock/timecard";
import { shortDateLabel } from "@/lib/worklist/dates";
import { t } from "@/features/scheduling/time-attendance/server/format-clock";

/** Sessions that day that matched no published shift (unscheduled clock-ins are allowed). */
export function UnscheduledWork({ date, items }: { date: string; items: UnscheduledWorkItem[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Unscheduled work</h2>
      <p className="text-xs text-slate-400">Punches on {shortDateLabel(date)} that don&apos;t match a published shift.</p>
      <ul className="mt-2 divide-y divide-slate-100 text-sm">
        {items.map((u, i) => (
          <li key={`${u.person_id}-${i}`} className="flex flex-wrap justify-between gap-2 py-2">
            <span className="text-slate-800">{u.person_name}</span>
            <span className="tabular-nums text-slate-600">
              {t(u.session.clock_in)} – {t(u.session.clock_out)}
              {u.session.worked_ms != null ? ` · ${formatDuration(u.session.worked_ms)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
