import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule, canEditModule } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { shortDateLabel, todayInWorkTz } from "@/lib/worklist/dates";
import { rangeDays, requestedDays } from "@/lib/pto/balance";
import { PageHeader } from "../../_components/ui";
import { PtoDecision } from "./pto-decision";

export const dynamic = "force-dynamic";

const SOURCES: Record<string, string> = {
  all: "All",
  wheniwork: "When I Work",
  self: "My Time",
  manual: "HR",
};

interface Row {
  id: string;
  person_id: string;
  kind: string;
  start_date: string;
  end_date: string;
  pto_days: number | string | null;
  note: string | null;
  source: string;
  created_at: string;
  person: { full_name: string | null; first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
}

const nameOf = (p: Row["person"]) =>
  p ? [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" ") || p.full_name || "Unknown" : "Unknown";

export default async function TimeOffQueuePage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const current = await getCurrentUser({ allowPreview: true });
  if (!current || !canEditModule(current.appUser, "schedule")) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Time-off requests are decided by schedule editors.
      </div>
    );
  }
  const { source: sourceParam } = await searchParams;
  const source = sourceParam && sourceParam in SOURCES ? sourceParam : "all";
  const today = todayInWorkTz();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("person_time_off")
    .select(
      "id, person_id, kind, start_date, end_date, pto_days, note, source, created_at, person:person_id (full_name, first_name, last_name, preferred_name)",
    )
    .eq("status", "requested")
    .order("start_date")
    .limit(1000);
  if (error) throw new Error(`Could not load time-off requests: ${error.message}`);
  const all = (data ?? []) as unknown as Row[];
  const rows = source === "all" ? all : all.filter((r) => r.source === source);

  // PTO balances are HR-private: shown to non-Staff users with HR access (same rule as the profile).
  const seesBalance = canAccessModule(current.appUser, "hr") && current.appUser.role !== "staff";
  const balances = new Map<string, number | null>();
  if (seesBalance && rows.length) {
    const { data: emp } = await admin
      .from("person_employment")
      .select("person_id, pto_available")
      .in("person_id", [...new Set(rows.map((r) => r.person_id))]);
    for (const e of (emp ?? []) as { person_id: string; pto_available: number | string | null }[]) {
      balances.set(e.person_id, e.pto_available === null ? null : Number(e.pto_available));
    }
  }

  const future = rows.filter((r) => r.end_date >= today);
  const past = rows.filter((r) => r.end_date < today);
  const counts = Object.fromEntries(
    Object.keys(SOURCES).map((k) => [k, k === "all" ? all.length : all.filter((r) => r.source === k).length]),
  );

  const table = (list: Row[]) => (
    <ul className="divide-y divide-slate-100">
      {list.map((r) => {
        const own = current.appUser.person_id === r.person_id;
        const available = seesBalance ? (balances.get(r.person_id) ?? null) : null;
        return (
          <li key={r.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]">
            <div className="text-sm">
              <span className="font-medium text-slate-800">{nameOf(r.person)}</span>
              <span className="ml-2 text-slate-600">
                {r.start_date === r.end_date
                  ? shortDateLabel(r.start_date)
                  : `${shortDateLabel(r.start_date)} – ${shortDateLabel(r.end_date)}`}{" "}
                · {rangeDays(r.start_date, r.end_date)} calendar day(s)
              </span>
              <span className="block text-xs text-slate-500">
                {SOURCES[r.source] ?? r.source}
                {r.kind === "time_off" ? " · requested as unpaid / personal" : r.kind === "vacation" ? " · vacation" : " · PTO"}
                {seesBalance ? ` · balance ${available === null ? "not on file" : `${available} day(s)`}` : ""}
              </span>
              {r.note ? <span className="block text-xs text-slate-500">“{r.note}”</span> : null}
            </div>
            <PtoDecision
              id={r.id}
              kind={r.kind}
              defaultDays={requestedDays(r)}
              maxDays={rangeDays(r.start_date, r.end_date)}
              available={available}
              disabled={own}
              disabledReason="Your own request — another approver decides it."
            />
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Time-off requests"
        description="Every pending request — from My Time, HR and the When I Work import — in one place. Choose paid PTO or unpaid and how many PTO days it uses, then approve or deny. Approving takes the days off the employee's balance immediately; 0 days approves without deducting (e.g. already counted)."
      />
      <p className="text-xs text-slate-500">
        How hours, premiums and PTO are calculated:{" "}
        <Link href="/hr/pto-rules" className="font-medium text-emerald-700 underline">
          PTO &amp; Timekeeping Rules
        </Link>
      </p>
      <nav className="flex flex-wrap gap-2" aria-label="Source">
        {Object.entries(SOURCES).map(([k, label]) => (
          <Link
            key={k}
            href={k === "all" ? "/schedule/time-off" : `/schedule/time-off?source=${k}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              k === source ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            {label} ({counts[k]})
          </Link>
        ))}
      </nav>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">
          Upcoming and current <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{future.length}</span>
        </h2>
        {future.length ? table(future) : <p className="mt-2 text-sm text-slate-500">Nothing waiting.</p>}
      </section>
      {past.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">
            Already passed, never decided <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{past.length}</span>
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            These dates are over. Approve the days that were actually taken and deny the rest. If the employee&apos;s PTO used on the profile already counts a request, approve it with 0 days so it isn&apos;t deducted twice.
          </p>
          {table(past)}
        </section>
      ) : null}
    </div>
  );
}
