"use client";

import { useTableSort, SortHeader, stickyHeadClass } from "../../_components/data-views";

export interface AuditEntry {
  id: string;
  actor_email: string | null;
  action: string;
  entity: string | null;
  summary: string | null;
  created_at: string;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  const sort = useTableSort(entries, {
    when: (e) => e.created_at,
    actor: (e) => e.actor_email ?? "system",
    action: (e) => e.action,
    detail: (e) => e.summary,
  });

  return (
    <div className="-mx-5 -mb-5 max-h-[70vh] overflow-auto">
      <table className="w-full text-sm">
        <thead className={stickyHeadClass}>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
            <SortHeader label="When" sortKey="when" sort={sort} className="px-5 py-2.5" />
            <SortHeader label="Actor" sortKey="actor" sort={sort} className="px-3 py-2.5" />
            <SortHeader label="Action" sortKey="action" sort={sort} className="px-3 py-2.5" />
            <SortHeader label="Detail" sortKey="detail" sort={sort} className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {sort.sorted.map((e) => (
            <tr key={e.id} className="border-b border-slate-50 last:border-0">
              <td className="whitespace-nowrap px-5 py-2.5 text-slate-500">
                {when(e.created_at)}
              </td>
              <td className="px-3 py-2.5 text-slate-600">
                {e.actor_email ?? "system"}
              </td>
              <td className="px-3 py-2.5">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                  {e.action}
                </span>
              </td>
              <td className="px-5 py-2.5 text-slate-700">{e.summary ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
