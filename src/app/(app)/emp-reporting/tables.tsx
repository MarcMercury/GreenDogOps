"use client";

import type { RoleStats } from "@/lib/hr/emp-reporting";
import { fmtCurrency } from "../reporting/charts";
import { useTableSort, SortHeader, stickyHeadClass } from "../_components/data-views";

type OutlierRow = RoleStats["outliers"][number] & {
  role: string;
  roleMedian: number;
};

export function OutliersTable({ outliers }: { outliers: OutlierRow[] }) {
  const sort = useTableSort(outliers, {
    employee: (m) => m.name,
    role: (m) => m.role,
    salary: (m) => m.salary,
    roleMedian: (m) => m.roleMedian,
    delta: (m) => m.deltaPct,
    flag: (m) => m.outlier,
  });

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className={stickyHeadClass}>
          <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <SortHeader label="Employee" sortKey="employee" sort={sort} className="py-2 pr-3" />
            <SortHeader label="Role" sortKey="role" sort={sort} className="py-2 pr-3" />
            <SortHeader label="Salary" sortKey="salary" sort={sort} align="right" className="py-2 pr-3" />
            <SortHeader label="Role median" sortKey="roleMedian" sort={sort} align="right" className="py-2 pr-3" />
            <SortHeader label="vs. median" sortKey="delta" sort={sort} align="right" className="py-2 pr-3" />
            <SortHeader label="Flag" sortKey="flag" sort={sort} className="py-2" />
          </tr>
        </thead>
        <tbody>
          {sort.sorted.map((m) => (
            <tr key={`${m.role}-${m.name}`} className="border-b border-slate-100">
              <td className="py-2 pr-3 font-medium text-slate-800">{m.name}</td>
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
  );
}

export function RoleTable({ roles }: { roles: RoleStats[] }) {
  const sort = useTableSort(roles, {
    role: (r) => r.role,
    people: (r) => r.count,
    average: (r) => r.avg,
    median: (r) => r.median,
    min: (r) => r.min,
    max: (r) => r.max,
    spread: (r) => r.spread,
    outliers: (r) => r.outliers.length,
  });

  if (roles.length === 0)
    return <p className="text-sm text-slate-400">No roster data to report.</p>;

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className={stickyHeadClass}>
          <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <SortHeader label="Role" sortKey="role" sort={sort} className="py-2 pr-3" />
            <SortHeader label="People" sortKey="people" sort={sort} align="right" className="py-2 pr-3" />
            <SortHeader label="Average" sortKey="average" sort={sort} align="right" className="py-2 pr-3" />
            <SortHeader label="Median" sortKey="median" sort={sort} align="right" className="py-2 pr-3" />
            <SortHeader label="Min" sortKey="min" sort={sort} align="right" className="py-2 pr-3" />
            <SortHeader label="Max" sortKey="max" sort={sort} align="right" className="py-2 pr-3" />
            <SortHeader label="Spread" sortKey="spread" sort={sort} align="right" className="py-2 pr-3" />
            <SortHeader label="Outliers" sortKey="outliers" sort={sort} align="right" className="py-2" />
          </tr>
        </thead>
        <tbody>
          {sort.sorted.map((r) => (
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
