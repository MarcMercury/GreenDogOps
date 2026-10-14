import Link from "next/link";
import { todayInWorkTz, addDays, shortDateLabel } from "@/lib/worklist/dates";
import {
  getLastPunch,
  getLocationNames,
  getMyShifts,
  getPunches,
  hasAckedNotice,
  TIME_CLOCK_TZ,
} from "@/lib/timeclock/server";
import { allowedPunches, canStartNewShift, clockState, hasAbandonedSession, PUNCH_LABELS } from "@/lib/timeclock/state";
import { buildSessions, formatDuration } from "@/lib/timeclock/timecard";
import { formatClockTime } from "@/lib/timeclock/local-time";
import { formatShiftTime } from "@/lib/timeclock/shift-match";
import { TIME_CLOCK_NOTICE } from "@/lib/timeclock/notice";
import { ClockPanel } from "./clock-panel";
import { AcceptNoticeButton } from "./accept-notice";
import { loadSelf, selfProblemMessage } from "./self";

export const dynamic = "force-dynamic";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</section>;
}

export default async function MyTimeHome() {
  const self = await loadSelf();
  if (!self.ok) {
    return (
      <Card>
        <p className="text-sm text-slate-600">{selfProblemMessage(self.reason)}</p>
      </Card>
    );
  }
  const { person } = self;
  const now = new Date();
  const today = todayInWorkTz(now);

  const [acked, last, todayShifts, upcoming, recentPunches, locationNames] = await Promise.all([
    hasAckedNotice(person.id),
    getLastPunch(person.id),
    getMyShifts(person.id, today, today),
    getMyShifts(person.id, addDays(today, 1), addDays(today, 14)),
    getPunches(person.id, addDays(today, -1), today),
    getLocationNames(),
  ]);

  const state = clockState(last, now);
  const abandoned = hasAbandonedSession(last, now);
  const sessions = buildSessions(recentPunches, now);
  const current = state === "off" ? null : sessions[sessions.length - 1] ?? null;
  const todayPunches = recentPunches.filter((p) => p.work_date === today || (current && p.work_date === current.work_date));
  const place = (id: string | null) => (id ? locationNames.get(id) ?? null : null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        {person.firstName ? `Hi ${person.firstName} — ` : ""}
        {new Date().toLocaleDateString("en-US", { timeZone: TIME_CLOCK_TZ, weekday: "long", month: "long", day: "numeric" })}
      </p>

      {!acked ? (
        <Card className="border-emerald-200">
          <h2 className="text-base font-semibold text-slate-900">Before your first punch</h2>
          <p className="mt-1 text-sm text-slate-600">Please read how the time clock works and what it records.</p>
          <dl className="mt-4 space-y-3">
            {TIME_CLOCK_NOTICE.map((s) => (
              <div key={s.heading}>
                <dt className="text-sm font-medium text-slate-800">{s.heading}</dt>
                <dd className="text-sm text-slate-600">{s.body}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5">
            <AcceptNoticeButton />
          </div>
        </Card>
      ) : !person.canPunch ? (
        <Card>
          <p className="text-sm text-slate-600">{selfProblemMessage("not_employee")}</p>
        </Card>
      ) : (
        <Card>
          <div className="mb-4">
            {state === "off" ? (
              <p className="text-lg font-semibold text-slate-900">You&apos;re not clocked in</p>
            ) : state === "on_lunch" ? (
              <p className="text-lg font-semibold text-amber-700">
                On lunch since {last ? formatClockTime(last.punched_at, TIME_CLOCK_TZ) : "—"}
              </p>
            ) : (
              <p className="text-lg font-semibold text-emerald-700">
                Clocked in since {current?.clock_in ? formatClockTime(current.clock_in, TIME_CLOCK_TZ) : "—"}
                {place(current?.location_id ?? null) ? ` · ${place(current?.location_id ?? null)}` : ""}
              </p>
            )}
            {current?.worked_ms != null ? (
              <p className="text-sm text-slate-500">Worked so far: {formatDuration(current.worked_ms)}</p>
            ) : null}
          </div>
          {abandoned && last ? (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Your last shift ({shortDateLabel(last.work_date)}) has no clock-out.{" "}
              <Link href="/me/timecard" className="font-medium underline">
                Request a correction
              </Link>
              .
            </p>
          ) : null}
          <ClockPanel
            allowed={allowedPunches(state)}
            offerNewShift={canStartNewShift(last, now)}
          />
          <p className="mt-4 text-xs text-slate-400">
            Your location is checked only when you press a button.{" "}
            <Link href="/me/privacy" className="underline">
              Privacy notice
            </Link>
          </p>
        </Card>
      )}

      <Card>
        <h2 className="text-sm font-semibold text-slate-900">Today&apos;s schedule</h2>
        {todayShifts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No published shift today. You can still clock in if you&apos;re working.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {todayShifts.map((s) => (
              <li key={s.assignment_id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="font-medium text-slate-800">
                  {formatShiftTime(s.start_time) ?? "Time not set"}
                  {s.end_time ? ` – ${formatShiftTime(s.end_time)}` : ""}
                </span>
                <span className="text-slate-500">
                  {[s.location_name, s.role ?? s.department, s.label].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {todayPunches.length > 0 ? (
        <Card>
          <h2 className="text-sm font-semibold text-slate-900">Today&apos;s punches</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {todayPunches.map((p) => (
              <li key={p.id} className="flex justify-between text-slate-600">
                <span>
                  {PUNCH_LABELS[p.punch_type]}
                  {p.approval === "pending" ? <span className="ml-2 text-xs text-amber-700">off-site · awaiting approval</span> : null}
                  {p.origin === "adjustment" ? <span className="ml-2 text-xs text-slate-400">added by a manager</span> : null}
                </span>
                <span className="tabular-nums">{formatClockTime(p.punched_at, TIME_CLOCK_TZ)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Coming up</h2>
          <Link href="/me/schedule" className="text-xs text-emerald-700 hover:underline">
            Full schedule
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No published shifts in the next two weeks.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {upcoming.slice(0, 5).map((s) => (
              <li key={s.assignment_id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span className="text-slate-800">{shortDateLabel(s.work_date)}</span>
                <span className="text-slate-500">
                  {formatShiftTime(s.start_time) ?? "Time not set"}
                  {s.end_time ? ` – ${formatShiftTime(s.end_time)}` : ""} · {s.location_name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
