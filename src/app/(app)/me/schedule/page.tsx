import { addDays, shortDateLabel, todayInWorkTz, weekdayOf } from "@/lib/worklist/dates";
import { getMyShifts, type MyShift } from "@/lib/timeclock/server";
import { formatShiftTime } from "@/lib/timeclock/shift-match";
import { loadSelf, selfProblemMessage } from "../self";

export const dynamic = "force-dynamic";

const PAST_DAYS = 7;
const FUTURE_DAYS = 28;

function weekStart(iso: string): string {
  return addDays(iso, -weekdayOf(iso));
}

export default async function MySchedulePage() {
  const self = await loadSelf();
  if (!self.ok) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        {selfProblemMessage(self.reason)}
      </section>
    );
  }
  const today = todayInWorkTz();
  const shifts = await getMyShifts(self.person.id, addDays(today, -PAST_DAYS), addDays(today, FUTURE_DAYS));

  const weeks = new Map<string, MyShift[]>();
  for (const s of shifts) {
    const key = weekStart(s.work_date);
    weeks.set(key, [...(weeks.get(key) ?? []), s]);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Only published schedules appear here. If a week is missing, it hasn&apos;t been published yet.
      </p>
      {weeks.size === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
          No published shifts from {shortDateLabel(addDays(today, -PAST_DAYS))} to{" "}
          {shortDateLabel(addDays(today, FUTURE_DAYS))}.
        </section>
      ) : (
        [...weeks.entries()].map(([start, list]) => (
          <section key={start} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">
              Week of {shortDateLabel(start)}
              {start === weekStart(today) ? <span className="ml-2 text-xs font-medium text-emerald-700">This week</span> : null}
            </h2>
            <ul className="mt-2 divide-y divide-slate-100">
              {list.map((s) => (
                <li
                  key={s.assignment_id}
                  className={`flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm ${
                    s.work_date < today ? "text-slate-400" : ""
                  }`}
                >
                  <span className={s.work_date === today ? "font-semibold text-emerald-700" : "font-medium text-slate-800"}>
                    {shortDateLabel(s.work_date)}
                    {s.work_date === today ? " · Today" : ""}
                  </span>
                  <span className="text-right text-slate-600">
                    {formatShiftTime(s.start_time) ?? "Time not set"}
                    {s.end_time ? ` – ${formatShiftTime(s.end_time)}` : ""}
                    <span className="block text-xs text-slate-500">
                      {[s.location_name, s.role ?? s.department, s.label].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
