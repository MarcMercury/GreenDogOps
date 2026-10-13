import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { canReviewTimeClock } from "@/lib/auth/permissions";
import { addDays, isIsoDate, shortDateLabel, todayInWorkTz } from "@/lib/worklist/dates";
import { formatClockTime } from "@/lib/timeclock/local-time";
import { formatShiftTime } from "@/lib/timeclock/shift-match";
import { TIME_CLOCK_TZ } from "@/lib/timeclock/server";
import { getAttendanceSettings, gradeRange, type AttendanceShift } from "@/lib/timeclock/attendance-server";
import { SHIFT_STATE_LABELS, type GradedShift, type ShiftState } from "@/lib/timeclock/attendance";
import { formatDuration, type EffectivePunch } from "@/lib/timeclock/timecard";
import { ATTENDANCE_LABELS } from "@/lib/schedule/types";
import { PageHeader } from "../../_components/ui";

export const dynamic = "force-dynamic";

const STATE_STYLE: Record<ShiftState, string> = {
  pto: "bg-sky-50 text-sky-700",
  upcoming: "bg-slate-100 text-slate-500",
  not_in_yet: "bg-amber-50 text-amber-800",
  missed: "bg-red-50 text-red-700",
  working: "bg-emerald-50 text-emerald-700",
  incomplete: "bg-amber-50 text-amber-800",
  left_early: "bg-amber-50 text-amber-800",
  completed: "bg-emerald-50 text-emerald-700",
};

type Row = GradedShift<AttendanceShift, EffectivePunch>;

const t = (iso: string | null | undefined) => (iso ? formatClockTime(iso, TIME_CLOCK_TZ) : "—");

function shiftTime(s: AttendanceShift) {
  const start = formatShiftTime(s.start_time);
  if (!start) return "No time set";
  return `${start}${s.end_time ? ` – ${formatShiftTime(s.end_time)}` : ""}`;
}

function Stat({ label, value, tone = "" }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone || "text-slate-900"}`}>{value}</p>
    </div>
  );
}

export default async function TimeAndAttendancePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const current = await getCurrentUser({ allowPreview: true });
  if (!current || !canReviewTimeClock(current.appUser)) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Time &amp; Attendance is for timecard approvers (Owner, Admin, Executive, HR / Manager) and Schedule Admins.
      </div>
    );
  }

  const { date: dateParam } = await searchParams;
  const today = todayInWorkTz();
  const date = dateParam && isIsoDate(dateParam) && dateParam <= addDays(today, 14) ? dateParam : today;
  const settings = await getAttendanceSettings();
  const { graded, unscheduled } = await gradeRange(date, date, { settings });

  const byLocation = new Map<string, { name: string; rows: Row[] }>();
  for (const g of graded) {
    const entry = byLocation.get(g.shift.location_id) ?? { name: g.shift.location_name, rows: [] };
    entry.rows.push(g);
    byLocation.set(g.shift.location_id, entry);
  }
  const locations = [...byLocation.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Time & Attendance"
        description="Published shifts graded from the time clock, live. A manager's attendance mark always wins."
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={`/schedule/time-attendance?date=${addDays(date, -1)}`}
          className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
        >
          ← {shortDateLabel(addDays(date, -1))}
        </Link>
        <span className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white">
          {shortDateLabel(date)}
          {date === today ? " · Today" : ""}
        </span>
        <Link
          href={`/schedule/time-attendance?date=${addDays(date, 1)}`}
          className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
        >
          {shortDateLabel(addDays(date, 1))} →
        </Link>
        {date !== today ? (
          <Link href="/schedule/time-attendance" className="text-emerald-700 hover:underline">
            Today
          </Link>
        ) : null}
      </div>

      <p
        className={`rounded-lg px-4 py-2.5 text-xs ${settings.liveFrom ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-600"}`}
      >
        {settings.liveFrom
          ? `Time-clock attendance counts from ${shortDateLabel(settings.liveFrom)}: unmarked shifts use these grades for reliability and the grid, and missed / late alerts are sent.`
          : "Shadow mode: these grades are shown here only. Reliability, the grid and alerts still use managers' marks until an Admin sets “Use time-clock attendance from” (Admin ▸ Settings ▸ Time clock)."}{" "}
        Late after {settings.thresholds.lateGraceMinutes} min, very late after {settings.thresholds.veryLateMinutes} min,
        missed after {settings.thresholds.missedAfterMinutes} min with no clock-in.
      </p>

      {locations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No published shifts on {shortDateLabel(date)}.
        </div>
      ) : null}

      {locations.map(([locId, { name, rows }]) => {
        const started = rows.filter((r) => r.state !== "upcoming" && r.state !== "pto");
        const matched = started.filter((r) => r.session !== null).length;
        const count = (s: ShiftState) => rows.filter((r) => r.state === s).length;
        const late = rows.filter((r) => r.lateLevel !== null).length;
        const sorted = [...rows].sort(
          (a, b) =>
            (a.shift.start_time ?? "99").localeCompare(b.shift.start_time ?? "99") ||
            a.shift.person_name.localeCompare(b.shift.person_name),
        );
        return (
          <section key={locId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">{name}</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              <Stat label="Scheduled" value={rows.length} />
              <Stat label="Clocked in" value={count("working")} tone="text-emerald-700" />
              <Stat label="Not in yet" value={count("not_in_yet")} tone={count("not_in_yet") ? "text-amber-700" : ""} />
              <Stat label="Late" value={late} tone={late ? "text-amber-700" : ""} />
              <Stat label="Missed" value={count("missed")} tone={count("missed") ? "text-red-700" : ""} />
              <Stat label="Done" value={count("completed") + count("left_early")} />
              <Stat label="PTO" value={count("pto")} />
              <Stat label="Punch match" value={started.length ? `${Math.round((matched / started.length) * 100)}%` : "—"} />
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Employee</th>
                    <th className="py-1.5 pr-3 font-medium">Shift</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 pr-3 font-medium">In</th>
                    <th className="py-1.5 pr-3 font-medium">Out</th>
                    <th className="py-1.5 font-medium">Worked</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map((r) => (
                    <tr key={r.shift.assignment_id}>
                      <td className="py-2 pr-3 text-slate-800">
                        {r.shift.person_name}
                        <span className="block text-xs text-slate-400">
                          {[r.shift.role, r.shift.label].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{shiftTime(r.shift)}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[r.state]}`}>
                          {SHIFT_STATE_LABELS[r.state]}
                        </span>
                        {r.lateLevel ? (
                          <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                            {r.lateLevel === "very_late" ? "Very late" : "Late"} {r.lateMinutes} min
                          </span>
                        ) : null}
                        {r.leftEarlyMinutes ? (
                          <span className="ml-1 text-xs text-slate-500">{r.leftEarlyMinutes} min early</span>
                        ) : null}
                        {r.shift.manual_status !== "scheduled" ? (
                          <span className="ml-1 text-xs text-slate-500">
                            Marked: {ATTENDANCE_LABELS[r.shift.manual_status]}
                          </span>
                        ) : null}
                        {r.session?.punches.some((p) => p.approval === "pending") ? (
                          <span className="ml-1 text-xs text-amber-700">off-site, awaiting approval</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-slate-700">{t(r.session?.clock_in)}</td>
                      <td className="py-2 pr-3 tabular-nums text-slate-700">{t(r.session?.clock_out)}</td>
                      <td className="py-2 tabular-nums text-slate-700">
                        {r.session?.worked_ms != null ? formatDuration(r.session.worked_ms) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {unscheduled.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Unscheduled work</h2>
          <p className="text-xs text-slate-400">Punches on {shortDateLabel(date)} that don&apos;t match a published shift.</p>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {unscheduled.map((u, i) => (
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
      ) : null}
    </div>
  );
}
