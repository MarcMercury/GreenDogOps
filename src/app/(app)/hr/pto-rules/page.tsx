import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule, canViewAllCompensation, isAdminRole } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, shortDateLabel, todayInWorkTz } from "@/lib/worklist/dates";
import { payPeriodFor } from "@/lib/timeclock/pay-period";
import { buildRules, RULES_SIGNOFF_ACTION, rulesVersion } from "@/lib/pto/rules";
import { nextStepAnniversary, TENURE_STEP_DAYS } from "@/lib/pto/annual";
import { PageHeader } from "../../_components/ui";
import { SignOffButton } from "./sign-off";

export const dynamic = "force-dynamic";

interface SignOff {
  actor_email: string | null;
  created_at: string;
  metadata: { version?: string; role?: string; name?: string | null } | null;
}

export default async function PtoRulesPage() {
  const current = await getCurrentUser({ allowPreview: true });
  if (!current || !canAccessModule(current.appUser, "hr")) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">You don&apos;t have access to HR.</div>;
  }
  const sections = buildRules();
  const version = rulesVersion(sections);
  const today = todayInWorkTz();
  const canSign = canViewAllCompensation(current.appUser.role);
  const seesPeople = current.appUser.role !== "staff";
  const seesLaborCode = isAdminRole(current.appUser.role);
  const admin = createAdminClient();

  const [signoffRes, hiresRes] = await Promise.all([
    admin
      .from("audit_log")
      .select("actor_email, created_at, metadata")
      .eq("action", RULES_SIGNOFF_ACTION)
      .order("created_at", { ascending: false })
      .limit(50),
    seesPeople
      ? admin
          .from("person_employment")
          .select("hire_date, person:person_id!inner (full_name, first_name, last_name, preferred_name, status)")
          .not("hire_date", "is", null)
          .eq("person.status", "employee")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const signoffs = (signoffRes.data ?? []) as SignOff[];
  const current_ = signoffs.filter((s) => s.metadata?.version === version);
  const older = signoffs.filter((s) => s.metadata?.version !== version);

  type Hire = { hire_date: string; person: { full_name: string | null; first_name: string | null; last_name: string | null; preferred_name: string | null } | null };
  const horizon = addDays(today, 365);
  const steps = ((hiresRes.data ?? []) as unknown as Hire[])
    .map((r) => ({
      name:
        [r.person?.preferred_name || r.person?.first_name, r.person?.last_name].filter(Boolean).join(" ") || r.person?.full_name || "Unknown",
      date: nextStepAnniversary(r.hire_date, today),
    }))
    .filter((s) => s.date <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date));

  const thisYear = Number(today.slice(0, 4));
  const payout = payPeriodFor(`${thisYear}-12-31`);
  const next = payPeriodFor(today);
  const upcomingPeriods = [next, payPeriodFor(addDays(next.end, 1)), payPeriodFor(addDays(next.end, 15))];
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="HR"
        title="PTO & Timekeeping Rules"
        description={`How Ops calculates hours, overtime, meal premiums, and PTO — in plain English${
          seesLaborCode ? ", with the California rule behind each" : ""
        }. The examples are computed by the same code that runs payroll, so this page always matches what Ops does.`}
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-semibold text-slate-900">Version {version}</span>
            <span className="ml-2 text-slate-500">
              {current_.length
                ? `Signed off by ${current_.map((s) => s.metadata?.name || s.actor_email).join(", ")}`
                : "Not signed off yet by Payroll / HR"}
            </span>
          </div>
          {canSign ? <SignOffButton version={version} /> : null}
        </div>
        {current_.length ? (
          <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
            {current_.map((s) => (
              <li key={s.created_at + s.actor_email}>
                ✓ {s.metadata?.name || s.actor_email} ({s.metadata?.role ?? "—"}) · {fmt(s.created_at)}
              </li>
            ))}
          </ul>
        ) : null}
        {older.length ? (
          <p className="mt-2 text-xs text-slate-400">
            {older.length} sign-off(s) of earlier versions — the rules have changed since, so they no longer count.
          </p>
        ) : null}
      </section>

      <nav className="flex flex-wrap gap-2 text-xs" aria-label="Sections">
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:border-slate-300">
            {s.title}
          </a>
        ))}
        <a href="#upcoming" className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:border-slate-300">
          Coming up
        </a>
      </nav>

      {sections.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">{s.title}</h2>
            {s.status === "policy" ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Policy — applied by HR until automated</span>
            ) : (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">Enforced by Ops</span>
            )}
          </div>
          {s.intro ? <p className="mt-1 text-sm text-slate-600">{s.intro}</p> : null}
          <ol className="mt-3 space-y-3">
            {s.rules.map((r, i) => (
              <li key={i} className="text-sm text-slate-800">
                <p>{r.text}</p>
                {r.example ? (
                  <p className="mt-1 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                    <span className="font-semibold">Example: </span>
                    {r.example}
                  </p>
                ) : null}
                {seesLaborCode && r.why ? (
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="font-semibold">Why: </span>
                    {r.why}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ))}

      <section id="upcoming" className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Coming up</h2>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          {upcomingPeriods.map((p) => (
            <li key={p.start}>
              Pay period {shortDateLabel(p.start)} – {shortDateLabel(p.end)} → payday {shortDateLabel(p.payDate)}
            </li>
          ))}
          <li>
            Year-end PTO payout (Dec 31, {thisYear} balance) → payday {shortDateLabel(payout.payDate)}; balances reset to the{" "}
            {thisYear + 1} allotment on Jan 1, {thisYear + 1}.
          </li>
        </ul>
        {seesPeople ? (
          <>
            <h3 className="mt-4 text-sm font-semibold text-slate-900">
              2-year anniversaries in the next 12 months (+{TENURE_STEP_DAYS} days from the following Jan 1)
            </h3>
            {steps.length ? (
              <ul className="mt-1 grid gap-x-6 gap-y-0.5 text-sm text-slate-700 sm:grid-cols-2">
                {steps.map((s) => (
                  <li key={s.name + s.date}>
                    {shortDateLabel(s.date)} · {s.name} → +{TENURE_STEP_DAYS} days from Jan 1, {Number(s.date.slice(0, 4)) + 1}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-slate-500">None.</p>
            )}
            {hiresRes.error ? <p className="mt-1 text-xs text-red-700">Could not load hire dates: {hiresRes.error.message}</p> : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
