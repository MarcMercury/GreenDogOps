"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type RosterRow,
  type EmploymentStatus,
  STATUS_LABELS,
  WORK_LOCATION_LABELS,
  SCHEDULE_LABELS,
} from "@/lib/hr/types";

const STATUS_BADGE: Record<EmploymentStatus, string> = {
  prospect: "bg-amber-100 text-amber-800",
  applicant: "bg-blue-100 text-blue-800",
  employee: "bg-emerald-100 text-emerald-800",
  former: "bg-slate-200 text-slate-600",
  contractor: "bg-violet-100 text-violet-800",
};

function displayName(r: RosterRow): string {
  if (r.full_name) return r.full_name;
  const parts = [r.first_name, r.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return r.grid_name ?? "—";
}

function formatRate(r: RosterRow): string {
  const emp = r.person_employment;
  if (!emp) return "—";
  if (emp.annual_wages) {
    return `$${Number(emp.annual_wages).toLocaleString("en-US")}/yr`;
  }
  if (emp.current_rate) {
    return `$${Number(emp.current_rate).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}/hr`;
  }
  return "—";
}

export function RosterGrid({ rows }: { rows: RosterRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<EmploymentStatus | "all">("employee");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      const haystack = [
        displayName(r),
        r.grid_name,
        r.email,
        r.person_employment?.adp_job_title,
        r.person_employment?.offer_title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query, status]);

  const statusTabs: Array<{ key: EmploymentStatus | "all"; label: string }> = [
    { key: "employee", label: "Current" },
    { key: "former", label: "Former" },
    { key: "contractor", label: "Contractors" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">HR / Roster</h1>
          <p className="mt-1 text-sm text-slate-500">
            {filtered.length} of {rows.length} people
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, title, email…"
          className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {statusTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              status === t.key
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t.label}
            <span className="ml-1.5 opacity-70">
              {t.key === "all" ? counts.all : (counts[t.key] ?? 0)}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Grid</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Schedule</th>
              <th className="px-4 py-3">Pay</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => {
              const emp = r.person_employment;
              return (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/hr/${r.id}`)}
                  className="cursor-pointer transition hover:bg-emerald-50"
                >
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {displayName(r)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {r.grid_name ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {emp?.adp_job_title ?? emp?.offer_title ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {r.work_location_type
                      ? WORK_LOCATION_LABELS[r.work_location_type]
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {emp?.work_schedule
                      ? SCHEDULE_LABELS[emp.work_schedule]
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{formatRate(r)}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status]}`}
                    >
                      {STATUS_LABELS[r.status]}
                    </span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-sm text-slate-400"
                >
                  No people match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
