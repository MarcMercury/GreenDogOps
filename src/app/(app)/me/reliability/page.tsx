import { getPersonAttendance } from "../../schedule/data";
import { shortDateLabel } from "@/lib/worklist/dates";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_TONE,
  RELIABILITY_WEIGHT,
  reliabilityTone,
  type AttendanceStatus,
} from "@/lib/schedule/types";
import { loadSelf, selfProblemMessage } from "../self";

export const dynamic = "force-dynamic";

const COUNTED: AttendanceStatus[] = ["present", "late", "late_excused", "absent", "absent_excused", "no_show", "pto"];

export default async function MyReliabilityPage() {
  const self = await loadSelf();
  if (!self.ok) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        {selfProblemMessage(self.reason)}
      </section>
    );
  }
  const { tally, score, records } = await getPersonAttendance(self.person.id);
  const resolved = COUNTED.reduce((n, k) => n + tally[k], 0);
  const pct = (n: number) => (resolved ? `${Math.round((n / resolved) * 100)}%` : "—");

  const byMonth = new Map<string, typeof records>();
  for (const r of records) {
    const key = r.work_date.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), r]);
  }
  const monthLabel = (ym: string) =>
    new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">My Reliability Score</h2>
            <p className={`mt-1 text-5xl font-bold tabular-nums ${reliabilityTone(score)}`}>{score == null ? "—" : `${score}%`}</p>
            <p className="mt-1 text-xs text-slate-500">
              {resolved ? `From ${resolved} shift${resolved === 1 ? "" : "s"} on published schedules.` : "No attendance recorded yet."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {COUNTED.map((k) => (
              <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs text-slate-500">{ATTENDANCE_LABELS[k]}</span>
                <span className="block text-lg font-semibold tabular-nums text-slate-900">
                  {tally[k]} <span className="text-xs font-normal text-slate-400">{pct(tally[k])}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          How it&apos;s scored: each shift counts{" "}
          {COUNTED.map((k, i) => (
            <span key={k}>
              {i ? ", " : ""}
              {ATTENDANCE_LABELS[k]} {Math.round(RELIABILITY_WEIGHT[k] * 100)}%
            </span>
          ))}
          . Your score is the average over all your shifts. 90% and above is green, 75–89% amber, below 75% red. If a
          mark looks wrong, talk to your manager.
        </p>
      </section>

      {[...byMonth.entries()].map(([ym, list]) => (
        <section key={ym} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">{monthLabel(ym)}</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {list.map((r) => (
              <li key={r.assignmentId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium text-slate-800">{shortDateLabel(r.work_date)}</span>
                  {r.location_name ? <span className="ml-2 text-xs text-slate-500">{r.location_name}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  {r.auto_absent ? <span className="text-xs text-slate-400">automatic</span> : null}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ATTENDANCE_TONE[r.status]}`}>
                    {ATTENDANCE_LABELS[r.status]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
