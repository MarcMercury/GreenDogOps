import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, shortDateLabel, todayInWorkTz } from "@/lib/worklist/dates";
import { formatDays, PAID_KINDS, PTO_BACKDATE_DAYS, PTO_MAX_AHEAD_DAYS, requestedDays } from "@/lib/pto/balance";
import { loadSelf, selfProblemMessage } from "../self";
import { PtoRequestForm, WithdrawPtoButton } from "./pto-form";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  requested: { label: "Waiting for review", cls: "bg-amber-50 text-amber-800" },
  approved: { label: "Approved", cls: "bg-emerald-50 text-emerald-800" },
  denied: { label: "Denied", cls: "bg-slate-100 text-slate-600" },
};

interface Row {
  id: string;
  kind: string;
  status: string;
  start_date: string;
  end_date: string;
  pto_days: number | string | null;
  note: string | null;
  review_note: string | null;
}

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

export default async function MyPtoPage() {
  const self = await loadSelf();
  if (!self.ok) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        {selfProblemMessage(self.reason)}
      </section>
    );
  }
  const today = todayInWorkTz();
  const admin = createAdminClient();
  const [empRes, reqRes] = await Promise.all([
    admin
      .from("person_employment")
      .select("pto_allotment, pto_policy_allotment, pto_used, pto_available")
      .eq("person_id", self.person.id)
      .maybeSingle(),
    admin
      .from("person_time_off")
      .select("id, kind, status, start_date, end_date, pto_days, note, review_note")
      .eq("person_id", self.person.id)
      .gte("end_date", addDays(today, -365))
      .order("start_date", { ascending: false })
      .limit(100),
  ]);
  const emp = empRes.data as {
    pto_allotment: string | null;
    pto_policy_allotment: number | string | null;
    pto_used: number | string | null;
    pto_available: number | string | null;
  } | null;
  const rows = (reqRes.data ?? []) as Row[];
  const available = num(emp?.pto_available);
  const used = num(emp?.pto_used);
  const extra = num(emp?.pto_policy_allotment);
  const pending = rows.filter((r) => r.status === "requested");
  const pendingDays = pending.filter((r) => PAID_KINDS.includes(r.kind)).reduce((n, r) => n + requestedDays(r), 0);
  const upcoming = rows.filter((r) => r.end_date >= today);
  const past = rows.filter((r) => r.end_date < today);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">My PTO</h2>
        {available === null ? (
          <p className="mt-2 text-sm text-slate-600">Your PTO balance isn&apos;t on file yet. Ask HR.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">
              Available
              <span className="block text-2xl font-semibold tabular-nums">{formatDays(available)}</span>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Used this year
              <span className="block text-lg font-semibold tabular-nums">{formatDays(used ?? 0)}</span>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Yearly allotment
              <span className="block text-lg font-semibold tabular-nums">
                {emp?.pto_allotment ?? "—"}
                {extra ? ` + ${extra}` : ""}
              </span>
            </div>
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              Waiting for review
              <span className="block text-lg font-semibold tabular-nums">{formatDays(pendingDays)}</span>
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          PTO covers both sick time and vacation, in days (1 day = 8 hours). Approved requests come off your balance
          straight away; pending ones don&apos;t until they&apos;re approved. Unused PTO is paid out at the end of the
          year.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Request time off</h2>
        <PtoRequestForm minDate={addDays(today, -PTO_BACKDATE_DAYS)} maxDate={addDays(today, PTO_MAX_AHEAD_DAYS)} today={today} />
      </section>

      {[
        { title: "Upcoming and current", list: upcoming },
        { title: "Past year", list: past },
      ].map(({ title, list }) =>
        list.length ? (
          <section key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">{title}</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {list.map((r) => {
                const st = STATUS[r.status] ?? { label: r.status, cls: "bg-slate-100 text-slate-600" };
                const paid = PAID_KINDS.includes(r.kind);
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium text-slate-800">
                        {r.start_date === r.end_date
                          ? shortDateLabel(r.start_date)
                          : `${shortDateLabel(r.start_date)} – ${shortDateLabel(r.end_date)}`}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {paid ? formatDays(requestedDays(r)) : "Unpaid"}
                      </span>
                      {r.note ? <span className="block text-xs text-slate-500">{r.note}</span> : null}
                      {r.review_note ? <span className="block text-xs text-slate-500">Manager: {r.review_note}</span> : null}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                      {r.status === "requested" ? <WithdrawPtoButton id={r.id} /> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}
