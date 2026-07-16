"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../_components/ui";
import {
  type CrmOrganization,
  type CrmOrgVisit,
  ORG_STATUS_OPTIONS,
  agreementStatusLabel,
} from "@/lib/crm/types";
import {
  ZONE_DEFINITIONS,
  getZoneDisplay,
  formatDate,
  statusClass,
} from "@/lib/crm/referral-types";
import { logRescueVisit, deleteRescue } from "./actions";
import { RescueMap } from "./rescue-map";

type TabKey = "list" | "map" | "targeting" | "activity" | "reports";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "list", label: "Rescues", icon: "📋" },
  { key: "map", label: "Map View", icon: "🗺️" },
  { key: "targeting", label: "Targeting", icon: "🎯" },
  { key: "activity", label: "Activity", icon: "🕑" },
  { key: "reports", label: "Reports", icon: "📊" },
];

const fieldInput =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const fieldLabel = "text-xs font-medium text-slate-500";
const selectClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

/** Areas in canonical order plus an "Unassigned" bucket last. */
const UNASSIGNED = "__unassigned__";

function daysSince(date: string | null | undefined): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

// Sort by last visit ASC with never-visited first (they are the highest
// targeting priority). Stable-ish tiebreak on name.
function compareByVisit(a: CrmOrganization, b: CrmOrganization): number {
  const av = a.last_visit_date ?? "";
  const bv = b.last_visit_date ?? "";
  if (av === bv) return a.name.localeCompare(b.name);
  if (!av) return -1;
  if (!bv) return 1;
  return av < bv ? -1 : 1;
}

export function RescueCrm({
  rescues,
  visits,
  canEdit,
  mapsApiKey,
}: {
  rescues: CrmOrganization[];
  visits: CrmOrgVisit[];
  canEdit: boolean;
  mapsApiKey: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("list");
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const [status, setStatus] = useState("");

  const [quickVisitFor, setQuickVisitFor] = useState<CrmOrganization | "any" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  const nameById = useMemo(
    () => new Map(rescues.map((r) => [r.id, r.name])),
    [rescues],
  );

  const stats = useMemo(() => {
    const total = rescues.length;
    const active = rescues.filter(
      (r) => (r.status || "").toLowerCase() === "active" || r.is_active,
    ).length;
    const adoptions = rescues.reduce((s, r) => s + (r.verified_adoptions || 0), 0);
    const neverVisited = rescues.filter((r) => !r.last_visit_date).length;
    const signed = rescues.filter((r) => r.agreement_status === "signed").length;
    return { total, active, adoptions, neverVisited, signed };
  }, [rescues]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rescues.filter((r) => {
      if (q) {
        const hay = `${r.name} ${r.contact_name ?? ""} ${r.email ?? ""} ${r.area ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (area && r.area !== area) return false;
      if (status && (r.status || "").toLowerCase() !== status) return false;
      return true;
    });
  }, [rescues, search, area, status]);

  function onDelete(r: CrmOrganization) {
    if (!confirm(`Delete "${r.name}"? This also removes its visit log and attachments.`)) return;
    startTransition(async () => {
      const res = await deleteRescue(r.id);
      notify(res.ok ? "Rescue deleted." : `Error: ${res.error}`);
      if (res.ok) router.refresh();
    });
  }

  function exportCsv() {
    const cols = [
      "Name", "Area", "Status", "Verified Adoptions", "Agreement",
      "Contact", "Phone", "Email", "Address", "Last Visit", "Notes",
    ];
    const rows = filtered.map((r) => [
      r.name, getZoneDisplay(r.area), r.status ?? "",
      String(r.verified_adoptions ?? 0), agreementStatusLabel(r.agreement_status),
      r.contact_name ?? "", r.phone ?? "", r.email ?? "", r.address ?? "",
      r.last_visit_date ?? "", (r.notes ?? "").replace(/\n/g, " "),
    ]);
    const csv = [cols, ...rows]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rescue-shelter-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {!canEdit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          You have read-only access to the Rescue/Shelter CRM. Changes are disabled.
        </div>
      )}
      <PageHeader
        eyebrow="CRM"
        title="Rescue/Shelter CRM"
        description="Rescue & shelter partners, visits, and verified adoptions"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <button
                onClick={() => setQuickVisitFor("any")}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700"
              >
                📍 Quick Visit
              </button>
            )}
            <button
              onClick={exportCsv}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              ⬇ Export
            </button>
            {canEdit && (
              <Link
                href="/crm/org/new?section=rescue"
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
              >
                + Add Rescue
              </Link>
            )}
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex flex-nowrap gap-1 overflow-x-auto border-b border-slate-200 pb-px sm:flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "bg-white text-emerald-700 shadow-[inset_0_-2px_0_0_#059669]"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <span className="mr-1">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <ListTab
          rescues={filtered}
          stats={stats}
          search={search} setSearch={setSearch}
          area={area} setArea={setArea}
          status={status} setStatus={setStatus}
          canEdit={canEdit}
          onQuickVisit={(r) => setQuickVisitFor(r)}
          onDelete={onDelete}
        />
      )}
      {tab === "map" && (
        <RescueMap
          rescues={rescues}
          mapsApiKey={mapsApiKey}
          canEdit={canEdit}
          onView={(r) => router.push(`/crm/org/${r.id}`)}
          onNotify={notify}
        />
      )}
      {tab === "targeting" && (
        <TargetingTab
          rescues={rescues}
          onFilterArea={(z) => { setArea(z); setTab("list"); }}
        />
      )}
      {tab === "activity" && <ActivityTab visits={visits} nameById={nameById} />}
      {tab === "reports" && <ReportsTab rescues={rescues} />}

      {quickVisitFor && (
        <QuickVisitDialog
          rescue={quickVisitFor === "any" ? null : quickVisitFor}
          rescues={rescues}
          onClose={() => setQuickVisitFor(null)}
          onSaved={(msg) => { setQuickVisitFor(null); notify(msg); router.refresh(); }}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Stat card
// ===========================================================================
function StatCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm transition ${
        danger ? "border-red-200 text-red-600 hover:bg-red-50" : "border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

// ===========================================================================
// List tab
// ===========================================================================
function ListTab({
  rescues, stats, search, setSearch, area, setArea, status, setStatus,
  canEdit, onQuickVisit, onDelete,
}: {
  rescues: CrmOrganization[];
  stats: { total: number; active: number; adoptions: number; neverVisited: number; signed: number };
  search: string; setSearch: (v: string) => void;
  area: string; setArea: (v: string) => void;
  status: string; setStatus: (v: string) => void;
  canEdit: boolean;
  onQuickVisit: (r: CrmOrganization) => void;
  onDelete: (r: CrmOrganization) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Rescues" value={String(stats.total)} tone="text-emerald-700" />
        <StatCard label="Active" value={String(stats.active)} tone="text-emerald-600" />
        <StatCard label="Verified Adoptions" value={stats.adoptions.toLocaleString()} tone="text-indigo-700" />
        <StatCard label="Signed Agreements" value={String(stats.signed)} tone="text-sky-700" />
        <StatCard label="Never Visited" value={String(stats.neverVisited)} tone="text-amber-600" />
      </div>

      <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rescues…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 sm:w-64"
          />
          <select value={area} onChange={(e) => setArea(e.target.value)} className={selectClass}>
            <option value="">All Areas</option>
            {ZONE_DEFINITIONS.map((z) => <option key={z.value} value={z.value}>{z.title}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
            <option value="">All Statuses</option>
            {ORG_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <RescueTable rescues={rescues} canEdit={canEdit} onQuickVisit={onQuickVisit} onDelete={onDelete} />
    </div>
  );
}

function RescueTable({
  rescues, canEdit, onQuickVisit, onDelete,
}: {
  rescues: CrmOrganization[];
  canEdit: boolean;
  onQuickVisit: (r: CrmOrganization) => void;
  onDelete: (r: CrmOrganization) => void;
}) {
  const router = useRouter();
  if (rescues.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-sm text-slate-500">
        No rescues match your filters.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Rescue</th>
            <th className="px-3 py-3">Area</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3 text-right">Verified Adoptions</th>
            <th className="px-3 py-3">Agreement</th>
            <th className="px-3 py-3">Last Visit</th>
            <th className="px-3 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rescues.map((r) => (
            <tr key={r.id} className="group cursor-pointer transition hover:bg-emerald-50/40" onClick={() => router.push(`/crm/org/${r.id}`)}>
              <td className="px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">
                    {r.name}
                    {r.is_preferred && <span className="ml-1.5 text-amber-500">★</span>}
                  </div>
                  {r.contact_name && <div className="truncate text-xs text-slate-400">{r.contact_name}</div>}
                </div>
              </td>
              <td className="px-3 py-3 text-xs text-slate-500">{getZoneDisplay(r.area)}</td>
              <td className="px-3 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusClass(r.status)}`}>
                  {r.status || (r.is_active ? "active" : "—")}
                </span>
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-700">{(r.verified_adoptions ?? 0).toLocaleString()}</td>
              <td className="px-3 py-3 text-xs text-slate-500">{agreementStatusLabel(r.agreement_status) || "—"}</td>
              <td className="px-3 py-3 text-xs text-slate-500">{formatDate(r.last_visit_date)}</td>
              <td className="px-3 py-3">
                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <IconBtn title="View / edit" onClick={() => router.push(`/crm/org/${r.id}`)}>👁</IconBtn>
                  {canEdit && <IconBtn title="Quick visit" onClick={() => onQuickVisit(r)}>📍</IconBtn>}
                  {canEdit && <IconBtn title="Delete" onClick={() => onDelete(r)} danger>🗑</IconBtn>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile cards */}
      <div className="divide-y divide-slate-100 sm:hidden">
        {rescues.map((r) => (
          <div key={r.id} className="p-4" onClick={() => router.push(`/crm/org/${r.id}`)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-900">{r.name}</div>
                <div className="truncate text-xs text-slate-400">{getZoneDisplay(r.area)}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusClass(r.status)}`}>{r.status || "—"}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>{(r.verified_adoptions ?? 0).toLocaleString()} adoptions</span>
              <span>Visit {formatDate(r.last_visit_date)}</span>
            </div>
            {canEdit && (
              <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <IconBtn title="Quick visit" onClick={() => onQuickVisit(r)}>📍</IconBtn>
                <IconBtn title="Delete" onClick={() => onDelete(r)} danger>🗑</IconBtn>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Targeting tab — grouped by area, oldest→newest visit within each area
// ===========================================================================
function TargetingTab({
  rescues, onFilterArea,
}: {
  rescues: CrmOrganization[];
  onFilterArea: (z: string) => void;
}) {
  const router = useRouter();
  const groups = useMemo(() => {
    const zoneOrder: string[] = ZONE_DEFINITIONS.map((z) => z.value);
    const buckets = new Map<string, CrmOrganization[]>();
    for (const r of rescues) {
      const key = r.area && zoneOrder.includes(r.area) ? r.area : UNASSIGNED;
      const arr = buckets.get(key) ?? [];
      arr.push(r);
      buckets.set(key, arr);
    }
    const ordered: { value: string; title: string; list: CrmOrganization[] }[] = [];
    for (const z of ZONE_DEFINITIONS) {
      const list = buckets.get(z.value);
      if (list && list.length) ordered.push({ value: z.value, title: z.title, list: [...list].sort(compareByVisit) });
    }
    const un = buckets.get(UNASSIGNED);
    if (un && un.length) ordered.push({ value: UNASSIGNED, title: "Unassigned Area 📍", list: [...un].sort(compareByVisit) });
    return ordered;
  }, [rescues]);

  const [open, setOpen] = useState<string | null>(groups[0]?.value ?? null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Rescues grouped by area, then ordered from the <strong>oldest (or never) visited</strong> to the most recent — work top-down to keep every relationship warm.
      </p>
      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-sm text-slate-500">
          No rescues to target yet.
        </div>
      )}
      {groups.map((g) => {
        const isOpen = open === g.value;
        const never = g.list.filter((r) => !r.last_visit_date).length;
        return (
          <div key={g.value} className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
            <button
              onClick={() => setOpen(isOpen ? null : g.value)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
            >
              <span className="font-medium text-slate-800">{g.title}</span>
              <span className="flex items-center gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{g.list.length}</span>
                {never > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{never} never visited</span>}
              </span>
            </button>
            {isOpen && (
              <div className="border-t border-slate-100">
                {g.value !== UNASSIGNED && (
                  <button onClick={() => onFilterArea(g.value)} className="px-4 pt-2 text-xs font-medium text-emerald-700 hover:underline">
                    Filter Rescues by this area →
                  </button>
                )}
                <table className="mt-1 w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-2">Rescue</th>
                      <th className="px-3 py-2">Last Visit</th>
                      <th className="px-3 py-2 text-right">Days Since</th>
                      <th className="px-3 py-2 text-right">Adoptions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.list.map((r) => {
                      const d = daysSince(r.last_visit_date);
                      return (
                        <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/crm/org/${r.id}`)}>
                          <td className="px-4 py-2 text-slate-700">{r.name}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">{formatDate(r.last_visit_date)}</td>
                          <td className="px-3 py-2 text-right text-xs">
                            {r.last_visit_date ? (
                              <span className={d != null && d > 180 ? "font-medium text-red-600" : "text-slate-500"}>{d}d</span>
                            ) : (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700">never</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{(r.verified_adoptions ?? 0).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Activity tab — visit feed across all rescues
// ===========================================================================
function ActivityTab({ visits, nameById }: { visits: CrmOrgVisit[]; nameById: Map<string, string> }) {
  const router = useRouter();
  if (visits.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-sm text-slate-500">No visits logged yet. Use “Quick Visit” to record activity.</div>;
  }
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Recent Rescue Visits</div>
      <ol className="divide-y divide-slate-100">
        {visits.slice(0, 100).map((v) => (
          <li
            key={v.id}
            className="cursor-pointer px-4 py-3 transition hover:bg-slate-50"
            onClick={() => router.push(`/crm/org/${v.org_id}`)}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-900">{nameById.get(v.org_id) ?? "Rescue"}</span>
              <span className="text-xs text-slate-400">{formatDate(v.visit_date)}</span>
            </div>
            {v.spoke_to && <p className="mt-0.5 text-xs text-slate-500">Spoke with: {v.spoke_to}</p>}
            {v.visit_notes && <p className="mt-1.5 text-sm text-slate-600">{v.visit_notes}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ===========================================================================
// Reports tab
// ===========================================================================
function Breakdown({ title, rows, total }: { title: string; rows: { label: string; count: number }[]; total: number }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">{title}</div>
      <ol className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="truncate text-slate-700">{r.label}</span>
            <span className="flex items-center gap-2">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-emerald-500" style={{ width: `${total ? (r.count / total) * 100 : 0}%` }} />
              </div>
              <span className="w-8 text-right tabular-nums text-slate-600">{r.count}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ReportsTab({ rescues }: { rescues: CrmOrganization[] }) {
  const total = rescues.length;
  const byArea = useMemo(() => {
    const rows: { label: string; count: number }[] = ZONE_DEFINITIONS.map((z) => ({
      label: z.title as string,
      count: rescues.filter((r) => r.area === z.value).length,
    }));
    const unassigned = rescues.filter(
      (r) => !r.area || !ZONE_DEFINITIONS.some((z) => z.value === r.area),
    ).length;
    if (unassigned) rows.push({ label: "Unassigned", count: unassigned });
    return rows.filter((r) => r.count > 0);
  }, [rescues]);

  const byStatus = useMemo(
    () =>
      ORG_STATUS_OPTIONS.map((s) => ({
        label: s.label,
        count: rescues.filter((r) => (r.status || "").toLowerCase() === s.value).length,
      })).filter((r) => r.count > 0),
    [rescues],
  );

  const byAgreement = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rescues) {
      const key = r.agreement_status || "none";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label: agreementStatusLabel(label) || "No agreement", count }))
      .sort((a, b) => b.count - a.count);
  }, [rescues]);

  const totalAdoptions = rescues.reduce((s, r) => s + (r.verified_adoptions || 0), 0);
  const topAdoptions = [...rescues]
    .filter((r) => (r.verified_adoptions || 0) > 0)
    .sort((a, b) => (b.verified_adoptions || 0) - (a.verified_adoptions || 0))
    .slice(0, 10);
  const neverVisited = rescues.filter((r) => !r.last_visit_date).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Rescues" value={String(total)} tone="text-emerald-700" />
        <StatCard label="Verified Adoptions" value={totalAdoptions.toLocaleString()} tone="text-indigo-700" />
        <StatCard label="Signed Agreements" value={String(rescues.filter((r) => r.agreement_status === "signed").length)} tone="text-sky-700" />
        <StatCard label="Never Visited" value={String(neverVisited.length)} tone="text-amber-600" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Breakdown title="Rescues by Area" rows={byArea} total={total} />
        <Breakdown title="Rescues by Status" rows={byStatus} total={total} />
        <Breakdown title="Rescues by Agreement" rows={byAgreement} total={total} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Top 10 by Verified Adoptions</div>
          {topAdoptions.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No adoptions recorded yet.</p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {topAdoptions.map((r, i) => (
                <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="truncate text-slate-700">{i + 1}. {r.name}</span>
                  <span className="tabular-nums text-slate-600">{(r.verified_adoptions ?? 0).toLocaleString()}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Never Visited</div>
          {neverVisited.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-emerald-600">✓ Every rescue has a logged visit.</p>
          ) : (
            <ol className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
              {neverVisited.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="truncate text-slate-700">{r.name}</span>
                  <span className="text-xs text-slate-400">{getZoneDisplay(r.area)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Quick Visit dialog
// ===========================================================================
function QuickVisitDialog({
  rescue, rescues, onClose, onSaved,
}: {
  rescue: CrmOrganization | null;
  rescues: CrmOrganization[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [orgId, setOrgId] = useState(rescue?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    if (!orgId) {
      setError("Please choose a rescue.");
      return;
    }
    formData.set("org_id", orgId);
    startTransition(async () => {
      const res = await logRescueVisit(formData);
      if (res.ok) onSaved(res.message ?? "Visit logged.");
      else setError(res.error);
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Log a Visit</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form action={submit} className="mt-4 space-y-3">
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Rescue</span>
            {rescue ? (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">{rescue.name}</div>
            ) : (
              <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={fieldInput}>
                <option value="">Select a rescue…</option>
                {rescues.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Visit date</span>
            <input type="date" name="visit_date" defaultValue={today} className={fieldInput} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Spoke with</span>
            <input name="spoke_to" placeholder="Name of contact" className={fieldInput} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Notes</span>
            <textarea name="visit_notes" rows={3} placeholder="What was discussed?" className={fieldInput} />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending ? "Saving…" : "Log Visit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
