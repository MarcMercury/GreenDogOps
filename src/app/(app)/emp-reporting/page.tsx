import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import {
  buildEmpReport,
  type EmpInput,
  type RoleStats,
} from "@/lib/hr/emp-reporting";
import { PageHeader } from "../_components/ui";
import { SectionCard, fmtCurrency } from "../reporting/charts";
import { RoleSalaryChart } from "./role-salary-chart";

export const dynamic = "force-dynamic";

interface EmploymentRow {
  position_id: string | null;
  offer_title: string | null;
  adp_job_title: string | null;
  pay_type: string | null;
  current_rate: number | null;
  annual_wages: number | null;
  biweekly_wage: number | null;
}

interface PersonRow {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  person_employment: EmploymentRow | EmploymentRow[] | null;
}

function personName(p: PersonRow): string {
  const composed = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return p.full_name?.trim() || composed || "Unknown";
}

export default async function EmpReportingPage() {
  const current = await getCurrentUser();

  // Payroll data is sensitive — admin/editor only, same gate as Reporting.
  if (!current || !canAccessModule(current.appUser, "emp_reporting")) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Business Intelligence"
          title="Emp Reporting"
          description="Roster payroll analytics."
        />
        <SectionCard
          title="Admin access required"
          description="Employee payroll reporting is limited to administrators."
        >
          <p className="text-sm text-slate-500">
            You don&apos;t have access to this page. If you believe you should,
            ask an administrator to grant you the Emp Reporting module.
          </p>
        </SectionCard>
      </div>
    );
  }

  const supabase = await createClient();
  const [peopleRes, positionsRes] = await Promise.all([
    supabase
      .from("person")
      .select(
        `id, full_name, first_name, last_name,
         person_employment (
           position_id, offer_title, adp_job_title,
           pay_type, current_rate, annual_wages, biweekly_wage
         )`,
      )
      .eq("status", "employee")
      .eq("is_active", true),
    supabase.from("position").select("id, title"),
  ]);

  if (peopleRes.error) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Business Intelligence"
          title="Emp Reporting"
          description="Roster payroll analytics."
        />
        <SectionCard title="Could not load roster">
          <p className="text-sm text-red-600">{peopleRes.error.message}</p>
        </SectionCard>
      </div>
    );
  }

  const titleById = new Map<string, string>(
    (positionsRes.data ?? []).map((p) => [p.id as string, p.title as string]),
  );

  const employees: EmpInput[] = ((peopleRes.data ?? []) as PersonRow[]).map(
    (p) => {
      const e = p.person_employment;
      const emp = Array.isArray(e) ? (e[0] ?? null) : e;
      const title =
        (emp?.position_id ? titleById.get(emp.position_id) : null) ||
        emp?.offer_title ||
        emp?.adp_job_title ||
        null;
      return {
        name: personName(p),
        title,
        payType: emp?.pay_type ?? null,
        annualWages: emp?.annual_wages ?? null,
        currentRate: emp?.current_rate ?? null,
        biweeklyWage: emp?.biweekly_wage ?? null,
      };
    },
  );

  const report = buildEmpReport(employees);
  const staffRoles = report.roles.filter((r) => r.kind === "staff");
  const doctorRoles = report.roles.filter((r) => r.kind === "doctor");
  const allOutliers = report.roles.flatMap((r) =>
    r.outliers.map((m) => ({ ...m, role: r.role, roleMedian: r.median })),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Business Intelligence"
        title="Emp Reporting"
        description="Average salaries by role, pay outliers, and company averages. Executives are excluded; doctors are shown but kept out of company averages."
      />

      {/* Company averages — staff only, excludes doctors + executives */}
      <SectionCard
        title="Company averages"
        description="Non-doctor, non-executive staff only."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Staff counted" value={String(report.company.headcount)} />
          <Stat label="Average salary" value={fmtCurrency(report.company.avg)} accent />
          <Stat label="Median salary" value={fmtCurrency(report.company.median)} />
          <Stat label="Lowest" value={fmtCurrency(report.company.min)} />
          <Stat label="Highest" value={fmtCurrency(report.company.max)} />
          <Stat label="Total annual" value={fmtCurrency(report.company.totalAnnual)} />
        </div>
        <p className="mt-3 text-xs text-slate-400">
          {report.excludedExecutives} executive
          {report.excludedExecutives === 1 ? "" : "s"} excluded
          {report.missingSalary > 0
            ? ` · ${report.missingSalary} without usable pay data skipped`
            : ""}
          .
        </p>
      </SectionCard>

      {/* Average salary per role — bar chart */}
      <SectionCard
        title="Average salary by role"
        description="Staff roles, highest average first. Click a role to see the employees counted in it."
      >
        <RoleSalaryChart roles={staffRoles} />
      </SectionCard>

      {/* Detailed grid */}
      <SectionCard
        title="Salary breakdown by role"
        description="Doctors are listed at the bottom and are not part of the company averages above."
      >
        <RoleTable roles={[...staffRoles, ...doctorRoles]} />
      </SectionCard>

      {/* Outliers */}
      <SectionCard
        title="Pay outliers"
        description="Employees whose salary falls outside 1.5× the interquartile range for their role (roles with 4+ people)."
      >
        {allOutliers.length === 0 ? (
          <p className="text-sm text-slate-400">
            No outliers detected in roles large enough to evaluate.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3">Employee</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3 text-right">Salary</th>
                  <th className="py-2 pr-3 text-right">Role median</th>
                  <th className="py-2 pr-3 text-right">vs. median</th>
                  <th className="py-2">Flag</th>
                </tr>
              </thead>
              <tbody>
                {allOutliers
                  .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
                  .map((m) => (
                    <tr
                      key={`${m.role}-${m.name}`}
                      className="border-b border-slate-100"
                    >
                      <td className="py-2 pr-3 font-medium text-slate-800">
                        {m.name}
                      </td>
                      <td className="py-2 pr-3 text-slate-500">{m.role}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-700">
                        {fmtCurrency(m.salary)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                        {fmtCurrency(m.roleMedian)}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right tabular-nums font-medium ${
                          m.deltaPct >= 0 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {m.deltaPct >= 0 ? "+" : ""}
                        {m.deltaPct.toFixed(0)}%
                      </td>
                      <td className="py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            m.outlier === "high"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-sky-50 text-sky-700"
                          }`}
                        >
                          {m.outlier === "high" ? "Above range" : "Below range"}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div
        className={`text-xl font-bold tracking-tight ${
          accent ? "text-emerald-600" : "text-slate-900"
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

function RoleTable({ roles }: { roles: RoleStats[] }) {
  if (roles.length === 0)
    return <p className="text-sm text-slate-400">No roster data to report.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <th className="py-2 pr-3">Role</th>
            <th className="py-2 pr-3 text-right">People</th>
            <th className="py-2 pr-3 text-right">Average</th>
            <th className="py-2 pr-3 text-right">Median</th>
            <th className="py-2 pr-3 text-right">Min</th>
            <th className="py-2 pr-3 text-right">Max</th>
            <th className="py-2 pr-3 text-right">Spread</th>
            <th className="py-2 text-right">Outliers</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.role} className="border-b border-slate-100">
              <td className="py-2 pr-3 font-medium text-slate-800">
                {r.role}
                {r.kind === "doctor" ? (
                  <span className="ml-2 inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                    excl. from co. avg
                  </span>
                ) : null}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                {r.count}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums font-semibold text-slate-900">
                {fmtCurrency(r.avg)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                {fmtCurrency(r.median)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                {fmtCurrency(r.min)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                {fmtCurrency(r.max)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                {fmtCurrency(r.spread)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {r.outliers.length > 0 ? (
                  <span className="font-semibold text-amber-600">
                    {r.outliers.length}
                  </span>
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
