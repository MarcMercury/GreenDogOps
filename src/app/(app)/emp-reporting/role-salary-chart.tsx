"use client";

import { useState } from "react";
import type { RoleStats } from "@/lib/hr/emp-reporting";

function fmtCurrency(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Clickable "Average salary by role" chart. Each bar is a button — clicking a
 * role expands the list of employees counted in that role, with their salary
 * and how they compare to the role median.
 */
export function RoleSalaryChart({ roles }: { roles: RoleStats[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (roles.length === 0)
    return <p className="text-xs text-slate-400">No staff salary data yet.</p>;

  const max = Math.max(1, ...roles.map((r) => r.avg));

  function toggle(role: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  return (
    <ul className="space-y-1.5">
      {roles.map((r) => {
        const isOpen = open.has(r.role);
        return (
          <li key={r.role}>
            <button
              type="button"
              onClick={() => toggle(r.role)}
              aria-expanded={isOpen}
              className="group w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50"
            >
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span
                    aria-hidden
                    className={`text-[10px] text-slate-400 transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  >
                    ▶
                  </span>
                  {r.role}
                  <span className="text-slate-400">({r.count})</span>
                </span>
                <span className="tabular-nums text-slate-500">
                  {fmtCurrency(r.avg)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all group-hover:bg-emerald-600"
                  style={{ width: `${(r.avg / max) * 100}%` }}
                />
              </div>
            </button>

            {isOpen ? (
              <div className="mt-1 overflow-x-auto rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="py-1 pr-3">Employee</th>
                      <th className="py-1 pr-3 text-right">Salary</th>
                      <th className="py-1 pr-3 text-right">vs. median</th>
                      <th className="py-1">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.members.map((m) => (
                      <tr
                        key={m.name}
                        className="border-t border-slate-100/80"
                      >
                        <td className="py-1 pr-3 font-medium text-slate-700">
                          {m.name}
                          {m.title ? (
                            <span className="ml-1.5 text-slate-400">
                              · {m.title}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums text-slate-700">
                          {fmtCurrency(m.salary)}
                        </td>
                        <td
                          className={`py-1 pr-3 text-right tabular-nums ${
                            m.deltaPct >= 0 ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {m.deltaPct >= 0 ? "+" : ""}
                          {m.deltaPct.toFixed(0)}%
                        </td>
                        <td className="py-1">
                          {m.outlier ? (
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                m.outlier === "high"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-sky-50 text-sky-700"
                              }`}
                            >
                              {m.outlier === "high" ? "Above range" : "Below range"}
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
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
