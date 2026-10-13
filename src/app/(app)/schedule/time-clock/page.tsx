import { getCurrentUser } from "@/lib/auth/session";
import { canApproveTime, canReviewTimeClock } from "@/lib/auth/permissions";
import { shortDateLabel } from "@/lib/worklist/dates";
import { formatClockTime } from "@/lib/timeclock/local-time";
import { getLocationNames, TIME_CLOCK_TZ } from "@/lib/timeclock/server";
import {
  getMissingPunches,
  getPendingCorrections,
  getPendingOffsite,
  MISSING_PUNCH_LOOKBACK_DAYS,
  OFFSITE_LOOKBACK_DAYS,
} from "@/lib/timeclock/review";
import { PUNCH_LABELS } from "@/lib/timeclock/state";
import { PageHeader } from "../../_components/ui";
import { AddPunchForm, CorrectionDecision, OffsiteDecision } from "./queue-controls";

export const dynamic = "force-dynamic";

const KIND_LABEL = { missing_punch: "Forgot to punch", wrong_time: "Wrong time", other: "Something else" } as const;

function Section({ title, count, hint, children }: { title: string; count: number; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          {title}{" "}
          <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${count > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>
            {count}
          </span>
        </h2>
        <p className="text-xs text-slate-400">{hint}</p>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const t = (iso: string) => formatClockTime(iso, TIME_CLOCK_TZ);

export default async function TimeClockQueuesPage() {
  const current = await getCurrentUser({ allowPreview: true });
  if (!current || !canReviewTimeClock(current.appUser)) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        The time-clock queues are for timecard approvers (Owner, Admin, Executive, HR / Manager) and Schedule Admins.
      </div>
    );
  }
  const approver = canApproveTime(current.appUser);
  const [offsite, corrections, missing, locationNames] = await Promise.all([
    getPendingOffsite(),
    getPendingCorrections(),
    getMissingPunches(),
    getLocationNames(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Time Clock"
        description={
          approver
            ? "Approve off-site punches and correction requests, and fix missing punches. Punches are never edited — every change is recorded alongside the original."
            : "Exceptions that need an approver. Schedule Admins can see them but only Owners, Admins, Executives and HR / Managers can change hours."
        }
      />

      <Section title="Off-site punches" count={offsite.length} hint={`Last ${OFFSITE_LOOKBACK_DAYS} days`}>
        {offsite.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing waiting.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {offsite.map((o) => (
              <li key={o.punch_id} className="grid gap-3 py-3 md:grid-cols-[1fr_18rem]">
                <div className="text-sm">
                  <p className="font-medium text-slate-900">
                    {o.person_name} · {PUNCH_LABELS[o.punch_type]} {shortDateLabel(o.work_date)} at {t(o.punched_at)}
                  </p>
                  <p className="text-slate-600">“{o.note}”</p>
                  <p className="text-xs text-slate-400">
                    {o.location_id ? `Scheduled at ${locationNames.get(o.location_id) ?? "—"}` : "Unscheduled"}
                    {o.distance_m != null ? ` · ${(o.distance_m / 1000).toFixed(1)} km from the clinic` : ""}
                  </p>
                  {approver ? (
                    <p className="text-xs text-slate-400">
                      IP {o.ip ?? "unknown"}
                      {o.latitude != null && o.longitude != null
                        ? ` · GPS ${o.latitude.toFixed(5)}, ${o.longitude.toFixed(5)} (±${Math.round(o.accuracy_m ?? 0)} m)`
                        : " · no GPS"}
                      {o.user_agent ? ` · ${o.user_agent.slice(0, 80)}` : ""}
                    </p>
                  ) : null}
                </div>
                {approver ? <OffsiteDecision punchId={o.punch_id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Correction requests" count={corrections.length} hint="From employees">
        {corrections.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing waiting.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {corrections.map((c) => {
              const targets = c.day_punches
                .filter((p) => p.punch_type === c.punch_type)
                .map((p) => ({
                  value: `${p.origin === "adjustment" ? "adjustment" : "punch"}:${p.id}`,
                  label: `${PUNCH_LABELS[p.punch_type]} at ${t(p.punched_at)}${p.origin === "adjustment" ? " (added)" : ""}`,
                }));
              return (
                <li key={c.id} className="grid gap-3 py-3 md:grid-cols-[1fr_18rem]">
                  <div className="text-sm">
                    <p className="font-medium text-slate-900">
                      {c.person_name} · {shortDateLabel(c.work_date)} · {KIND_LABEL[c.kind]}
                      {c.punch_type ? ` · ${PUNCH_LABELS[c.punch_type]}` : ""}
                      {c.requested_time ? ` → ${t(c.requested_time)}` : ""}
                    </p>
                    <p className="text-slate-600">“{c.reason}”</p>
                    <p className="text-xs text-slate-400">
                      That day:{" "}
                      {c.day_punches.length === 0
                        ? "no punches"
                        : c.day_punches.map((p) => `${PUNCH_LABELS[p.punch_type]} ${t(p.punched_at)}`).join(" · ")}
                    </p>
                    {c.kind === "other" ? (
                      <p className="text-xs text-slate-400">Approving records the decision only; add any punch below if needed.</p>
                    ) : null}
                  </div>
                  {approver ? (
                    <CorrectionDecision requestId={c.id} needsTarget={c.kind === "wrong_time"} targets={targets} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Missing punches" count={missing.length} hint={`Last ${MISSING_PUNCH_LOOKBACK_DAYS} days`}>
        {missing.length === 0 ? (
          <p className="text-sm text-slate-500">Every shift has a clock-in and clock-out.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {missing.map((m) => (
              <li key={`${m.person_id}|${m.work_date}|${m.first_punch_at}`} className="grid gap-3 py-3 md:grid-cols-[1fr_18rem]">
                <div className="text-sm">
                  <p className="font-medium text-slate-900">
                    {m.person_name} · {shortDateLabel(m.work_date)} ·{" "}
                    {m.status === "missing_clock_out" ? "No clock-out" : "No clock-in"}
                  </p>
                  <p className="text-xs text-slate-400">
                    First punch: {PUNCH_LABELS[m.first_punch_type]} at {t(m.first_punch_at)}
                    {m.has_request ? " · the employee has asked for a correction (above)" : ""}
                  </p>
                </div>
                {approver ? (
                  <AddPunchForm
                    personId={m.person_id}
                    workDate={m.work_date}
                    defaultType={m.status === "missing_clock_out" ? "clock_out" : "clock_in"}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
