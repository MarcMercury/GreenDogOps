"use client";

import { useMemo, useState, useTransition, useRef } from "react";
import { PageHeader } from "../../_components/ui";
import {
  ReferralPartner,
  ClinicVisit,
  SyncHistoryRow,
  UnmatchedEntry,
  PartnerContact,
  PartnerNote,
  ZONE_DEFINITIONS,
  REFERRAL_TIERS,
  REFERRAL_PRIORITIES,
  VISIT_ITEM_OPTIONS,
  NOTE_CATEGORY_OPTIONS,
  CONTACT_METHOD_OPTIONS,
  partnerName,
  getZoneDisplay,
  formatCurrency,
  formatCompactCurrency,
  formatDate,
  tierClass,
  priorityClass,
  healthColor,
  statusClass,
  titleCase,
} from "@/lib/crm/referral-types";
import {
  recalculateMetrics,
  clearReferralStats,
  undoReferralUpload,
  parseReferralUpload,
  logQuickVisit,
  deletePartner,
  addUnmatchedPartner,
  dismissUnmatched,
  saveContact,
  deleteContact,
  saveNote,
  deleteNote,
  getReferralReport,
  type UploadResult,
  type ReferralReport,
} from "./actions";
import { PartnerDialog } from "./partner-dialog";
import { PartnerMap } from "./partner-map";
import {
  type CellValue,
  type SortDir,
  SortIcon,
  compareValues,
} from "../../_components/data-views";

type TabKey = "list" | "map" | "targeting" | "activity" | "upload-log" | "reports";
type FollowFilter = "all" | "followup" | "overdue";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "list", label: "Partners", icon: "📋" },
  { key: "map", label: "Map View", icon: "🗺️" },
  { key: "targeting", label: "Targeting", icon: "🎯" },
  { key: "activity", label: "Activity", icon: "🕑" },
  { key: "upload-log", label: "Upload Log", icon: "📤" },
  { key: "reports", label: "Reports", icon: "📊" },
];

const fieldInput = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const fieldLabel = "text-xs font-medium text-slate-500";

export function ReferralCrm({
  partners,
  visits,
  history,
  unmatched,
  contacts,
  notes,
  isAdmin,
  canEdit = false,
  mapsApiKey,
}: {
  partners: ReferralPartner[];
  visits: ClinicVisit[];
  history: SyncHistoryRow[];
  unmatched: UnmatchedEntry[];
  contacts: PartnerContact[];
  notes: PartnerNote[];
  isAdmin: boolean;
  canEdit?: boolean;
  mapsApiKey: string;
}) {
  const [tab, setTab] = useState<TabKey>("list");
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("");
  const [zone, setZone] = useState("");
  const [priority, setPriority] = useState("");
  const [follow, setFollow] = useState<FollowFilter>("all");

  const [detail, setDetail] = useState<ReferralPartner | null>(null);
  const [editing, setEditing] = useState<ReferralPartner | "new" | null>(null);
  const [quickVisitFor, setQuickVisitFor] = useState<ReferralPartner | "any" | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [pending, startTransition] = useTransition();

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  // ----- Stats -----
  const stats = useMemo(() => {
    const total = partners.length;
    const active = partners.filter((p) => (p.status || "").toLowerCase() === "active" || p.is_active).length;
    const totalReferrals = partners.reduce((s, p) => s + (p.total_referrals_all_time || 0), 0);
    const totalRevenue = partners.reduce((s, p) => s + (Number(p.total_revenue_all_time) || 0), 0);
    const needFollowup = partners.filter((p) => p.needs_followup).length;
    const overdue = partners.filter((p) => p.visit_overdue).length;
    return { total, active, totalReferrals, totalRevenue, needFollowup, overdue };
  }, [partners]);

  // ----- Filtered list -----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partners.filter((p) => {
      if (q) {
        const hay = `${partnerName(p)} ${p.contact_name ?? ""} ${p.email ?? ""} ${p.zone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (tier && p.tier !== tier) return false;
      if (zone && p.zone !== zone) return false;
      if (priority && p.priority !== priority) return false;
      if (follow === "followup" && !p.needs_followup) return false;
      if (follow === "overdue" && !p.visit_overdue) return false;
      return true;
    });
  }, [partners, search, tier, zone, priority, follow]);

  function runRecalc() {
    startTransition(async () => {
      const r = await recalculateMetrics();
      notify(r.ok ? r.message ?? "Recalculated." : `Error: ${r.error}`);
    });
  }

  function exportCsv() {
    const cols = [
      "Name", "Tier", "Priority", "Zone", "Status", "Phone", "Email", "Address",
      "Clinic Type", "Total Referrals", "Revenue", "Last Referral", "Last Visit", "Notes",
    ];
    const rows = filtered.map((p) => [
      partnerName(p), p.tier ?? "", p.priority ?? "", p.zone ?? "", p.status ?? "",
      p.phone ?? "", p.email ?? "", p.address ?? "", p.clinic_type ?? "",
      String(p.total_referrals_all_time ?? 0), String(p.total_revenue_all_time ?? 0),
      p.last_referral_date ?? "", p.last_visit_date ?? "", (p.notes ?? "").replace(/\n/g, " "),
    ]);
    const csv = [cols, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "medical-partnerships-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {!canEdit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          You have read-only access to the Referral CRM. Changes are disabled.
        </div>
      )}
      <PageHeader
        eyebrow="CRM"
        title="Referral CRM"
        description="Manage referral clinics, contacts, and relationship touchpoints"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setQuickVisitFor("any")}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700"
            >
              📍 Quick Visit
            </button>
            <button
              onClick={runRecalc}
              disabled={pending}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              ↻ Recalculate Metrics
            </button>
            <button
              onClick={exportCsv}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              ⬇ Export
            </button>
            <button
              onClick={() => setShowUpload(true)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              📄 Upload EzyVet Report
            </button>
            <button
              onClick={() => setEditing("new")}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
            >
              + Add Partner
            </button>
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
            {t.key === "upload-log" && unmatched.length > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold text-white">
                {unmatched.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <PartnersTab
          partners={filtered}
          stats={stats}
          search={search} setSearch={setSearch}
          tier={tier} setTier={setTier}
          zone={zone} setZone={setZone}
          priority={priority} setPriority={setPriority}
          follow={follow} setFollow={setFollow}
          onView={setDetail}
          onEdit={(p) => setEditing(p)}
          onQuickVisit={(p) => setQuickVisitFor(p)}
          onDelete={(p) => {
            if (!confirm(`Delete "${partnerName(p)}"? This also removes its visit logs.`)) return;
            startTransition(async () => {
              const r = await deletePartner(p.id);
              notify(r.ok ? "Partner deleted." : `Error: ${r.error}`);
            });
          }}
        />
      )}

      {tab === "map" && <MapTab partners={partners} mapsApiKey={mapsApiKey} onView={setDetail} onNotify={notify} />}
      {tab === "targeting" && <TargetingTab partners={partners} onFilterZone={(z) => { setZone(z); setTab("list"); }} onView={setDetail} />}
      {tab === "activity" && <ActivityTab visits={visits} />}
      {tab === "upload-log" && (
        <UploadLogTab
          history={history}
          unmatched={unmatched}
          isAdmin={isAdmin}
          onUndo={(id) => {
            if (!confirm("Undo this upload? Its revenue rows will be removed and totals recomputed.")) return;
            startTransition(async () => {
              const r = await undoReferralUpload(id);
              notify(r.ok ? r.message ?? "Undone." : `Error: ${r.error}`);
            });
          }}
          onClearAll={() => {
            if (!confirm("Clear ALL referral stats? This deletes every revenue line item and resets all partner totals to 0. This cannot be undone.")) return;
            startTransition(async () => {
              const r = await clearReferralStats();
              notify(r.ok ? r.message ?? "Cleared." : `Error: ${r.error}`);
            });
          }}
          onAddUnmatched={(clinicName) => {
            const fd = new FormData();
            fd.set("clinic_name", clinicName);
            startTransition(async () => {
              const r = await addUnmatchedPartner(fd);
              notify(r.ok ? r.message ?? "Partner added." : `Error: ${r.error}`);
            });
          }}
          onDismissUnmatched={(clinicName) => {
            if (!confirm(`Remove "${clinicName}" from the match list? Its uploaded referral rows will be deleted and no partner will be created.`)) return;
            startTransition(async () => {
              const r = await dismissUnmatched(clinicName);
              notify(r.ok ? r.message ?? "Removed." : `Error: ${r.error}`);
            });
          }}
        />
      )}
      {tab === "reports" && <ReportsTab partners={partners} />}

      {/* Dialogs */}
      {detail && (
        <DetailDialog
          partner={detail}
          visits={visits.filter((v) => v.partner_id === detail.id)}
          contacts={contacts.filter((c) => c.partner_id === detail.id)}
          notes={notes.filter((n) => n.partner_id === detail.id)}
          onClose={() => setDetail(null)}
          onEdit={() => { setEditing(detail); setDetail(null); }}
          onQuickVisit={() => { setQuickVisitFor(detail); setDetail(null); }}
          onChange={notify}
        />
      )}
      {editing && (
        <PartnerDialog
          partner={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); notify(msg); }}
        />
      )}
      {quickVisitFor && (
        <QuickVisitDialog
          partner={quickVisitFor === "any" ? null : quickVisitFor}
          partners={partners}
          onClose={() => setQuickVisitFor(null)}
          onSaved={(msg) => { setQuickVisitFor(null); notify(msg); }}
        />
      )}
      {showUpload && (
        <UploadDialog
          isAdmin={isAdmin}
          onClose={() => setShowUpload(false)}
          onDone={(msg) => notify(msg)}
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
// Partners tab
// ===========================================================================
function StatCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm`}>
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

function PartnersTab({
  partners, stats, search, setSearch, tier, setTier, zone, setZone, priority, setPriority,
  follow, setFollow, onView, onEdit, onQuickVisit, onDelete,
}: {
  partners: ReferralPartner[];
  stats: { total: number; active: number; totalReferrals: number; totalRevenue: number; needFollowup: number; overdue: number };
  search: string; setSearch: (v: string) => void;
  tier: string; setTier: (v: string) => void;
  zone: string; setZone: (v: string) => void;
  priority: string; setPriority: (v: string) => void;
  follow: FollowFilter; setFollow: (v: FollowFilter) => void;
  onView: (p: ReferralPartner) => void;
  onEdit: (p: ReferralPartner) => void;
  onQuickVisit: (p: ReferralPartner) => void;
  onDelete: (p: ReferralPartner) => void;
}) {
  const selectClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total Partners" value={String(stats.total)} tone="text-emerald-700" />
        <StatCard label="Active" value={String(stats.active)} tone="text-emerald-600" />
        <StatCard label="Total Referrals" value={stats.totalReferrals.toLocaleString()} tone="text-sky-700" />
        <StatCard label="Total Revenue" value={formatCompactCurrency(stats.totalRevenue)} tone="text-indigo-700" />
        <StatCard label="Need Follow-up" value={String(stats.needFollowup)} tone="text-amber-600" />
        <StatCard label="Overdue Visits" value={String(stats.overdue)} tone="text-red-600" />
      </div>

      <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search partners…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 sm:w-64"
          />
          <select value={tier} onChange={(e) => setTier(e.target.value)} className={selectClass}>
            <option value="">All Tiers</option>
            {REFERRAL_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={zone} onChange={(e) => setZone(e.target.value)} className={selectClass}>
            <option value="">All Zones</option>
            {ZONE_DEFINITIONS.map((z) => <option key={z.value} value={z.value}>{z.title}</option>)}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selectClass}>
            <option value="">All Priorities</option>
            {REFERRAL_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-nowrap gap-1.5 overflow-x-auto sm:flex-wrap">
          {([["all", "All"], ["followup", "Follow-up"], ["overdue", "Overdue"]] as [FollowFilter, string][]).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFollow(k)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
                follow === k ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <PartnerTable
        partners={partners}
        onView={onView}
        onEdit={onEdit}
        onQuickVisit={onQuickVisit}
        onDelete={onDelete}
      />
    </div>
  );
}

function PartnerTable({
  partners, onView, onEdit, onQuickVisit, onDelete,
}: {
  partners: ReferralPartner[];
  onView: (p: ReferralPartner) => void;
  onEdit: (p: ReferralPartner) => void;
  onQuickVisit: (p: ReferralPartner) => void;
  onDelete: (p: ReferralPartner) => void;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const SORTS: Record<string, (p: ReferralPartner) => CellValue> = {
    partner: (p) => partnerName(p),
    priority: (p) => p.priority,
    health: (p) => Number(p.relationship_health) || 0,
    status: (p) => p.status || (p.is_active ? "active" : ""),
    referrals: (p) => p.total_referrals_all_time || 0,
    revenue: (p) => Number(p.total_revenue_all_time) || 0,
    last_referral: (p) => p.last_referral_date,
    divisions: (p) => p.referral_divisions?.length ?? 0,
    last_visit: (p) => p.last_visit_date,
  };

  const sorted = useMemo(() => {
    if (!sortKey || !SORTS[sortKey]) return partners;
    const accessor = SORTS[sortKey];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...partners].sort((a, b) => compareValues(accessor(a), accessor(b)) * dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partners, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir("asc");
    }
  }

  const renderTh = (
    label: React.ReactNode,
    opts: { sortKeyName?: string; right?: boolean; wide?: boolean } = {},
  ) => {
    const { sortKeyName, right, wide } = opts;
    return (
      <th
        onClick={sortKeyName ? () => toggleSort(sortKeyName) : undefined}
        className={`${wide ? "px-4" : "px-3"} py-3 ${right ? "text-right" : ""} ${
          sortKeyName ? "cursor-pointer select-none hover:text-slate-700" : ""
        }`}
      >
        <span className={`inline-flex items-center ${right ? "justify-end" : ""}`}>
          {label}
          {sortKeyName && <SortIcon dir={sortKey === sortKeyName ? sortDir : null} />}
        </span>
      </th>
    );
  };

  if (partners.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-sm text-slate-500">
        No partners match your filters.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      {/* Desktop */}
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            {renderTh("Partner", { sortKeyName: "partner", wide: true })}
            {renderTh("Priority", { sortKeyName: "priority" })}
            {renderTh("Health", { sortKeyName: "health" })}
            {renderTh("Status", { sortKeyName: "status" })}
            {renderTh("Referrals", { sortKeyName: "referrals", right: true })}
            {renderTh("Revenue", { sortKeyName: "revenue", right: true })}
            {renderTh("Last Referral", { sortKeyName: "last_referral" })}
            {renderTh("Divisions", { sortKeyName: "divisions" })}
            {renderTh("Last Visit", { sortKeyName: "last_visit" })}
            {renderTh("Actions", { right: true })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((p) => (
            <tr key={p.id} className="group cursor-pointer transition hover:bg-emerald-50/40" onClick={() => onView(p)}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ${tierClass(p.tier)}`}>
                    {partnerName(p).charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">{partnerName(p)}</div>
                    <div className="truncate text-xs text-slate-400">{titleCase(p.clinic_type) || "—"}{p.zone ? ` · ${p.zone}` : ""}</div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${priorityClass(p.priority)}`}>
                  {p.priority || "—"}
                </span>
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full ${healthColor(p.relationship_health)}`} style={{ width: `${Math.min(100, Number(p.relationship_health) || 0)}%` }} />
                  </div>
                  <span className="text-xs text-slate-500">{p.relationship_health ?? 0}%</span>
                </div>
              </td>
              <td className="px-3 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusClass(p.status)}`}>
                  {p.status || (p.is_active ? "active" : "—")}
                </span>
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-700">{(p.total_referrals_all_time || 0).toLocaleString()}</td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-700">{formatCurrency(p.total_revenue_all_time)}</td>
              <td className="px-3 py-3 text-xs text-slate-500">{formatDate(p.last_referral_date)}</td>
              <td className="px-3 py-3">
                {p.referral_divisions && p.referral_divisions.length > 0 ? (
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{p.referral_divisions.length}</span>
                ) : <span className="text-xs text-slate-300">—</span>}
              </td>
              <td className="px-3 py-3 text-xs">
                <span className={p.visit_overdue ? "font-medium text-red-600" : "text-slate-500"}>{formatDate(p.last_visit_date)}</span>
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <IconBtn title="View" onClick={() => onView(p)}>👁</IconBtn>
                  <IconBtn title="Quick visit" onClick={() => onQuickVisit(p)}>📍</IconBtn>
                  <IconBtn title="Edit" onClick={() => onEdit(p)}>✏️</IconBtn>
                  <IconBtn title="Delete" onClick={() => onDelete(p)} danger>🗑</IconBtn>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile cards */}
      <div className="divide-y divide-slate-100 sm:hidden">
        {sorted.map((p) => (
          <div key={p.id} className="p-4" onClick={() => onView(p)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-900">{partnerName(p)}</div>
                <div className="truncate text-xs text-slate-400">{titleCase(p.clinic_type) || "—"}{p.zone ? ` · ${p.zone}` : ""}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${priorityClass(p.priority)}`}>{p.priority || "—"}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>{(p.total_referrals_all_time || 0).toLocaleString()} referrals</span>
              <span>{formatCurrency(p.total_revenue_all_time)}</span>
              <span>Health {p.relationship_health ?? 0}%</span>
              <span className={p.visit_overdue ? "font-medium text-red-600" : ""}>Visit {formatDate(p.last_visit_date)}</span>
            </div>
            <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <IconBtn title="Quick visit" onClick={() => onQuickVisit(p)}>📍</IconBtn>
              <IconBtn title="Edit" onClick={() => onEdit(p)}>✏️</IconBtn>
              <IconBtn title="Delete" onClick={() => onDelete(p)} danger>🗑</IconBtn>
            </div>
          </div>
        ))}
      </div>
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
// Map tab — zone-grouped geographic summary
// ===========================================================================
function MapTab({
  partners,
  mapsApiKey,
  onView,
  onNotify,
}: {
  partners: ReferralPartner[];
  mapsApiKey: string;
  onView: (p: ReferralPartner) => void;
  onNotify: (msg: string) => void;
}) {
  return (
    <PartnerMap
      partners={partners}
      mapsApiKey={mapsApiKey}
      onView={onView}
      onNotify={onNotify}
    />
  );
}

// ===========================================================================
// Targeting tab — collapsible sections, dynamically ordered by clinic priority
// ===========================================================================
const PRIORITY_RANK: Record<string, number> = { "Very High": 4, High: 3, Medium: 2, Low: 1 };
function priorityRank(p: ReferralPartner): number {
  return PRIORITY_RANK[(p.priority ?? "").trim()] ?? 0;
}

// Sort clinics so the most important targets surface first: overdue, then
// higher priority, then weaker relationship health.
function compareTargets(a: ReferralPartner, b: ReferralPartner): number {
  if (!!a.visit_overdue !== !!b.visit_overdue) return a.visit_overdue ? -1 : 1;
  const pr = priorityRank(b) - priorityRank(a);
  if (pr !== 0) return pr;
  return (a.relationship_health ?? 0) - (b.relationship_health ?? 0);
}

function CollapsibleSection({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-slate-50 ${open ? "border-b border-slate-100" : ""}`}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
          </svg>
          {title}
        </span>
        {badge}
      </button>
      {open && children}
    </div>
  );
}

function TargetingTab({
  partners, onFilterZone, onView,
}: {
  partners: ReferralPartner[];
  onFilterZone: (z: string) => void;
  onView: (p: ReferralPartner) => void;
}) {
  const overdue = partners.filter((p) => p.visit_overdue).sort(compareTargets);
  const followups = partners.filter((p) => p.needs_followup);
  const active = partners.filter((p) => (p.status || "").toLowerCase() === "active" || p.is_active);

  // Clinics grouped by priority — only non-empty levels are shown, ordered
  // from highest to lowest priority. Reflects the latest priority values.
  const prioritySet = new Set<string>(REFERRAL_PRIORITIES);
  const priorityGroups = REFERRAL_PRIORITIES
    .map((pr) => ({
      priority: pr as string,
      list: partners.filter((p) => (p.priority ?? "").trim() === pr).sort(compareTargets),
    }))
    .filter((g) => g.list.length > 0);
  const noPriority = partners.filter((p) => !prioritySet.has((p.priority ?? "").trim())).sort(compareTargets);

  // Zones ordered dynamically by aggregate clinic priority weight so the
  // highest-priority regions float to the top as priorities change.
  const zoneGroups = ZONE_DEFINITIONS.map((z) => {
    const list = partners.filter((p) => p.zone === z.value).sort(compareTargets);
    return { z, list, weight: list.reduce((s, p) => s + priorityRank(p), 0) };
  }).sort((a, b) => b.weight - a.weight);

  const [openPriority, setOpenPriority] = useState<string | null>(priorityGroups[0]?.priority ?? null);
  const [openZone, setOpenZone] = useState<string | null>(zoneGroups[0]?.z.value ?? null);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active Partners" value={String(active.length)} tone="text-emerald-700" />
        <StatCard label="Overdue Visits" value={String(overdue.length)} tone="text-red-600" />
        <StatCard label="Follow-ups" value={String(followups.length)} tone="text-amber-600" />
        <StatCard label="Zones" value={String(ZONE_DEFINITIONS.length)} tone="text-sky-700" />
      </div>

      <CollapsibleSection
        title="Priority Targets"
        badge={<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{partners.length}</span>}
      >
        <div className="divide-y divide-slate-100">
          {priorityGroups.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No clinics to prioritize yet.</p>
          )}
          {priorityGroups.map((g) => {
            const od = g.list.filter((p) => p.visit_overdue).length;
            const isOpen = openPriority === g.priority;
            return (
              <div key={g.priority}>
                <button
                  onClick={() => setOpenPriority(isOpen ? null : g.priority)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${priorityClass(g.priority)}`}>{g.priority}</span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{g.list.length}</span>
                    {od > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{od} overdue</span>}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-1 bg-slate-50/60 px-4 pb-3">
                    {g.list.slice(0, 25).map((p) => (
                      <button key={p.id} onClick={() => onView(p)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white">
                        <span className="truncate text-slate-700">{partnerName(p)}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-400">{getZoneDisplay(p.zone)}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[11px] ring-1 ${tierClass(p.tier)}`}>{p.tier || "—"}</span>
                          {p.visit_overdue && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] text-red-700">overdue</span>}
                        </span>
                      </button>
                    ))}
                    {g.list.length > 25 && <p className="px-2 pt-1 text-[11px] text-slate-400">+{g.list.length - 25} more</p>}
                  </div>
                )}
              </div>
            );
          })}
          {noPriority.length > 0 && (
            <div>
              <button
                onClick={() => setOpenPriority(openPriority === "__none" ? null : "__none")}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              >
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">Unprioritized</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{noPriority.length}</span>
              </button>
              {openPriority === "__none" && (
                <div className="space-y-1 bg-slate-50/60 px-4 pb-3">
                  {noPriority.slice(0, 25).map((p) => (
                    <button key={p.id} onClick={() => onView(p)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white">
                      <span className="truncate text-slate-700">{partnerName(p)}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-400">{getZoneDisplay(p.zone)}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[11px] ring-1 ${tierClass(p.tier)}`}>{p.tier || "—"}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Target Clinics by Region"
        badge={<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{ZONE_DEFINITIONS.length} zones</span>}
      >
        <div className="divide-y divide-slate-100">
          {zoneGroups.map(({ z, list }) => {
            const od = list.filter((p) => p.visit_overdue).length;
            const fu = list.filter((p) => p.needs_followup).length;
            const isOpen = openZone === z.value;
            return (
              <div key={z.value}>
                <button
                  onClick={() => setOpenZone(isOpen ? null : z.value)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-800">{z.title}</span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{list.length}</span>
                    {od > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{od} overdue</span>}
                    {fu > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{fu} follow-up</span>}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-1 bg-slate-50/60 px-4 pb-3">
                    <button onClick={() => onFilterZone(z.value)} className="mb-1 text-xs font-medium text-emerald-700 hover:underline">
                      Filter Partners by this zone →
                    </button>
                    {list.length === 0 && <p className="py-2 text-xs text-slate-400">No partners in this zone.</p>}
                    {list.slice(0, 25).map((p) => (
                      <button key={p.id} onClick={() => onView(p)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white">
                        <span className="truncate text-slate-700">{partnerName(p)}</span>
                        <span className="flex items-center gap-1.5">
                          <span className={`rounded-full px-1.5 py-0.5 text-[11px] ring-1 ${priorityClass(p.priority)}`}>{p.priority || "—"}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[11px] ring-1 ${tierClass(p.tier)}`}>{p.tier || "—"}</span>
                          {p.visit_overdue && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] text-red-700">overdue</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Overdue Visits"
        badge={<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{overdue.length}</span>}
      >
        {overdue.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-emerald-600">✓ All caught up!</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {overdue.slice(0, 50).map((p) => (
              <button key={p.id} onClick={() => onView(p)} className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm text-slate-700">{partnerName(p)}</span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] ring-1 ${priorityClass(p.priority)}`}>{p.priority || "—"}</span>
                </span>
                <span className="text-xs text-red-600">{p.days_since_last_visit ?? "—"} days · {getZoneDisplay(p.zone)}</span>
              </button>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}

// ===========================================================================
// Activity tab
// ===========================================================================
function ActivityTab({ visits }: { visits: ClinicVisit[] }) {
  if (visits.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-sm text-slate-500">No recent visits logged.</div>;
  }
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Recent Clinic Visits</div>
      <ol className="divide-y divide-slate-100">
        {visits.slice(0, 20).map((v) => (
          <li key={v.id} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-900">{v.clinic_name}</span>
              <span className="text-xs text-slate-400">{formatDate(v.visit_date)}</span>
            </div>
            {v.spoke_to && <p className="mt-0.5 text-xs text-slate-500">Spoke with: {v.spoke_to}</p>}
            {v.items_discussed && v.items_discussed.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {v.items_discussed.map((it) => (
                  <span key={it} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-100">{titleCase(it)}</span>
                ))}
              </div>
            )}
            {v.visit_notes && <p className="mt-1.5 text-sm text-slate-600">{v.visit_notes}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ===========================================================================
// Upload Log tab
// ===========================================================================
function UploadLogTab({
  history, unmatched, isAdmin, onUndo, onClearAll, onAddUnmatched, onDismissUnmatched,
}: {
  history: SyncHistoryRow[];
  unmatched: UnmatchedEntry[];
  isAdmin: boolean;
  onUndo: (id: string) => void;
  onClearAll: () => void;
  onAddUnmatched: (clinicName: string) => void;
  onDismissUnmatched: (clinicName: string) => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      {isAdmin && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50/50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-red-800">Danger zone</p>
            <p className="text-xs text-red-600">Delete all revenue line items and reset every partner&rsquo;s totals to zero.</p>
          </div>
          <button onClick={onClearAll} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">Clear All Stats</button>
        </div>
      )}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="text-sm font-semibold text-slate-800">
            Match — Referral Sources Not in CRM {unmatched.length > 0 && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{unmatched.length}</span>}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">Clinics found in uploaded reports with no matching partner. <strong>Add</strong> creates a full profile and links their referral data; <strong>Delete</strong> just removes them from this list.</p>
        </div>
        {unmatched.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No unmatched entries.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">Clinic Name</th>
                  <th className="px-3 py-2 text-right">Visits</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2">Upload Date</th>
                  <th className="px-3 py-2">Date Range</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unmatched.map((u) => (
                  <tr key={u.clinicName}>
                    <td className="px-4 py-2 text-slate-800">{u.clinicName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{u.visits}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(u.revenue)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{formatDate(u.uploadDate)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{u.dateRange}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setAdding(u.clinicName); onAddUnmatched(u.clinicName); }}
                          disabled={adding === u.clinicName || dismissing === u.clinicName}
                          className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          title="Create a partner from this clinic and link its referrals"
                        >
                          {adding === u.clinicName ? "Adding…" : "+ Add to CRM"}
                        </button>
                        <button
                          onClick={() => { setDismissing(u.clinicName); onDismissUnmatched(u.clinicName); }}
                          disabled={adding === u.clinicName || dismissing === u.clinicName}
                          className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                          title="Remove from the match list without adding a partner"
                        >
                          {dismissing === u.clinicName ? "Removing…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Upload History</div>
        {history.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No uploads yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">Uploaded</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Date Range</th>
                  <th className="px-3 py-2 text-right">Parsed</th>
                  <th className="px-3 py-2 text-right">Matched</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  {isAdmin && <th className="px-3 py-2 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((h) => {
                  const undone = !!(h.sync_details && (h.sync_details as Record<string, unknown>).undone_at);
                  return (
                    <tr key={h.id} className={undone ? "opacity-50" : ""}>
                      <td className="px-4 py-2 text-xs text-slate-500">{formatDate(h.upload_date)}</td>
                      <td className="px-3 py-2 max-w-[14rem] truncate text-slate-700" title={h.filename}>{h.filename}</td>
                      <td className="px-3 py-2 text-xs">{h.report_type ? titleCase(h.report_type) : "—"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {h.date_range_start && h.date_range_end ? `${h.date_range_start} → ${h.date_range_end}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.total_rows_parsed ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.total_rows_matched ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(h.total_revenue_added)}</td>
                      {isAdmin && (
                        <td className="px-3 py-2 text-right">
                          {undone ? (
                            <span className="text-xs text-slate-400">undone</span>
                          ) : h.report_type === "revenue" ? (
                            <button onClick={() => onUndo(h.id)} className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">Undo</button>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Reports tab
// ===========================================================================
type RangePreset = "30d" | "90d" | "6m" | "12m" | "ytd" | "custom";

const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: "30d", label: "Last 30 Days" },
  { key: "90d", label: "Last 90 Days" },
  { key: "6m", label: "Last 6 Months" },
  { key: "12m", label: "Last 12 Months" },
  { key: "ytd", label: "Year to Date" },
  { key: "custom", label: "Custom Range" },
];

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeForPreset(preset: RangePreset): { from: string; to: string } {
  const today = new Date();
  const to = isoDay(today);
  const start = new Date(today);
  switch (preset) {
    case "30d": start.setDate(start.getDate() - 30); break;
    case "90d": start.setDate(start.getDate() - 90); break;
    case "6m": start.setMonth(start.getMonth() - 6); break;
    case "12m": start.setFullYear(start.getFullYear() - 1); break;
    case "ytd": start.setMonth(0, 1); break;
    default: start.setDate(start.getDate() - 30); break;
  }
  return { from: isoDay(start), to };
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function ReportsTab({ partners }: { partners: ReferralPartner[] }) {
  const byTier = REFERRAL_TIERS.map((t) => ({ label: t, count: partners.filter((p) => p.tier === t).length, criteria: TIER_CRITERIA[t] }));
  const byPriority = REFERRAL_PRIORITIES.map((t) => ({ label: t, count: partners.filter((p) => p.priority === t).length, criteria: PRIORITY_CRITERIA[t] }));
  const top = [...partners].sort((a, b) => (Number(b.total_revenue_all_time) || 0) - (Number(a.total_revenue_all_time) || 0)).slice(0, 10);
  const atRisk = partners.filter((p) => (p.relationship_health ?? 100) < 40).sort((a, b) => (a.relationship_health ?? 0) - (b.relationship_health ?? 0)).slice(0, 10);

  const initial = rangeForPreset("30d");
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<ReferralReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onPresetChange(next: RangePreset) {
    setPreset(next);
    if (next !== "custom") {
      const r = rangeForPreset(next);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  function generate() {
    setError(null);
    startTransition(async () => {
      const res = await getReferralReport(from, to);
      if (res.ok) {
        setReport(res.report);
      } else {
        setReport(null);
        setError(res.error);
      }
    });
  }

  const maxMonthly = report ? Math.max(1, ...report.monthly.map((m) => m.revenue)) : 1;

  return (
    <div className="space-y-5">
      {/* --- Date range report --- */}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <div className="flex flex-col gap-1">
            <span className={fieldLabel}>Time Period</span>
            <select
              value={preset}
              onChange={(e) => onPresetChange(e.target.value as RangePreset)}
              className={`${fieldInput} min-w-44`}
            >
              {RANGE_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className={fieldLabel}>From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }}
              className={fieldInput}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className={fieldLabel}>To</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => { setTo(e.target.value); setPreset("custom"); }}
              className={fieldInput}
            />
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
          >
            📊 {pending ? "Generating…" : "Generate"}
          </button>
        </div>

        {error && (
          <p className="px-4 py-3 text-sm text-red-600">{error}</p>
        )}

        {!report && !error && (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
            <span className="text-3xl text-slate-300">📈</span>
            <p className="text-sm font-medium text-slate-500">Select a time period and click Generate</p>
            <p className="text-xs text-slate-400">View referral metrics, top clinics, visit counts, and revenue breakdowns</p>
          </div>
        )}

        {report && (
          <div className="space-y-5 p-4">
            <p className="text-xs text-slate-500">
              {formatDate(report.start)} – {formatDate(report.end)}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ReportStat label="Total Revenue" value={formatCurrency(report.totalRevenue)} />
              <ReportStat label="Total Referrals" value={report.totalReferrals.toLocaleString()} />
              <ReportStat label="Referring Clinics" value={report.uniqueClinics.toLocaleString()} />
              <ReportStat
                label="Matched Revenue"
                value={formatCurrency(report.matchedRevenue)}
                sub={report.unmatchedRevenue > 0 ? `${formatCurrency(report.unmatchedRevenue)} unmatched` : undefined}
              />
            </div>

            {report.totalReferrals === 0 ? (
              <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                No referral revenue recorded in this period.
              </p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200/80 bg-white">
                  <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Top Clinics by Revenue</div>
                  <ol className="divide-y divide-slate-100">
                    {report.topClinics.map((c, i) => (
                      <li key={`${c.partnerId ?? c.name}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                        <span className="truncate text-slate-700">
                          {i + 1}. {c.name}
                          {!c.matched && <span className="ml-1 text-xs text-amber-600">(unmatched)</span>}
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="text-xs text-slate-400">{c.referrals} ref</span>
                          <span className="tabular-nums text-slate-600">{formatCurrency(c.revenue)}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200/80 bg-white">
                    <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Monthly Trend</div>
                    <div className="space-y-2 p-4">
                      {report.monthly.length === 0 ? (
                        <p className="text-center text-xs text-slate-400">No dated line items.</p>
                      ) : report.monthly.map((m) => (
                        <div key={m.month} className="flex items-center gap-3">
                          <span className="w-20 shrink-0 text-xs text-slate-500">{formatMonthLabel(m.month)}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full bg-emerald-500" style={{ width: `${(m.revenue / maxMonthly) * 100}%` }} />
                          </div>
                          <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-600">{formatCompactCurrency(m.revenue)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {report.byDivision.length > 0 && (
                    <div className="rounded-xl border border-slate-200/80 bg-white">
                      <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Revenue by Division</div>
                      <ol className="divide-y divide-slate-100">
                        {report.byDivision.map((d) => (
                          <li key={d.division} className="flex items-center justify-between px-4 py-2 text-sm">
                            <span className="truncate text-slate-700">{d.division}</span>
                            <span className="tabular-nums text-slate-600">{formatCurrency(d.revenue)}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* --- All-time partner breakdowns --- */}
      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown title="Partners by Tier" rows={byTier} total={partners.length} />
        <Breakdown title="Partners by Priority" rows={byPriority} total={partners.length} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Top 10 by Revenue</div>
          <ol className="divide-y divide-slate-100">
            {top.map((p, i) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="truncate text-slate-700">{i + 1}. {partnerName(p)}</span>
                <span className="tabular-nums text-slate-600">{formatCurrency(p.total_revenue_all_time)}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">At-Risk Relationships</div>
          {atRisk.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-emerald-600">No at-risk partners.</p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {atRisk.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="truncate text-slate-700">{partnerName(p)}</span>
                  <span className="text-xs text-red-600">{p.relationship_health ?? 0}% · {p.relationship_status}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

// Fixed-threshold criteria surfaced on hover (mirror recalculate_partner_metrics()).
const TIER_CRITERIA: Record<string, string> = {
  Platinum: "$30,000+ lifetime revenue",
  Gold: "$15,000 – $30,000 lifetime revenue",
  Silver: "$5,000 – $15,000 lifetime revenue",
  Bronze: "$500 – $5,000 lifetime revenue",
  Coal: "Under $500 lifetime revenue",
};

const PRIORITY_CRITERIA: Record<string, string> = {
  "Very High": "20+ lifetime referrals",
  High: "10 – 19 lifetime referrals",
  Medium: "3 – 9 lifetime referrals",
  Low: "Under 3 lifetime referrals",
};

function Breakdown({ title, rows, total }: { title: string; rows: { label: string; count: number; criteria?: string }[]; total: number }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">{title}</div>
      <div className="space-y-2 p-4">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center gap-3"
            title={r.criteria ? `${r.label}: ${r.criteria}` : undefined}
          >
            <span className="w-20 shrink-0 text-xs text-slate-500">{r.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-emerald-500" style={{ width: `${total ? (r.count / total) * 100 : 0}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-600">{r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Detail dialog
// ===========================================================================
function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value || "—"}</dd>
    </div>
  );
}

function DetailDialog({
  partner, visits, contacts, notes, onClose, onEdit, onQuickVisit, onChange,
}: {
  partner: ReferralPartner;
  visits: ClinicVisit[];
  contacts: PartnerContact[];
  notes: PartnerNote[];
  onClose: () => void;
  onEdit: () => void;
  onQuickVisit: () => void;
  onChange: (msg: string) => void;
}) {
  return (
    <Modal onClose={onClose} wide>
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{partnerName(partner)}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tierClass(partner.tier)}`}>{partner.tier || "—"}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${priorityClass(partner.priority)}`}>{partner.priority || "—"}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusClass(partner.status)}`}>{partner.status || "—"}</span>
            {partner.zone && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{getZoneDisplay(partner.zone)}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={onQuickVisit} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Log Visit</button>
          <button onClick={onEdit} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">Edit</button>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-500 hover:bg-slate-50">✕</button>
        </div>
      </div>

      <div className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Referrals" value={(partner.total_referrals_all_time || 0).toLocaleString()} tone="text-sky-700" />
          <StatCard label="Total Revenue" value={formatCurrency(partner.total_revenue_all_time)} tone="text-indigo-700" />
          <StatCard label="Relationship" value={`${partner.relationship_health ?? 0}%`} tone="text-emerald-700" />
          <StatCard label="Last Visit" value={formatDate(partner.last_visit_date)} tone="text-slate-700" />
        </div>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Contact</h3>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <DetailRow label="Contact" value={partner.contact_name || partner.contact_person} />
            <DetailRow label="Phone" value={partner.phone ? <a className="text-emerald-700 hover:underline" href={`tel:${partner.phone}`}>{partner.phone}</a> : null} />
            <DetailRow label="Email" value={partner.email ? <a className="text-emerald-700 hover:underline" href={`mailto:${partner.email}`}>{partner.email}</a> : null} />
            <DetailRow label="Website" value={partner.website ? <a className="text-emerald-700 hover:underline" href={partner.website} target="_blank" rel="noreferrer">{partner.website}</a> : null} />
            <DetailRow label="Address" value={partner.address} />
            <DetailRow label="Instagram" value={partner.instagram_handle} />
          </dl>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Classification</h3>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <DetailRow label="Clinic Type" value={titleCase(partner.clinic_type)} />
            <DetailRow label="Size" value={titleCase(partner.size)} />
            <DetailRow label="Organization" value={titleCase(partner.organization_type)} />
            <DetailRow label="Employees" value={partner.employee_count} />
            <DetailRow label="Visit Frequency" value={titleCase(partner.visit_frequency)} />
            <DetailRow label="Best Contact" value={partner.best_contact_person} />
            <DetailRow label="Services" value={partner.services?.join(", ")} />
            <DetailRow label="Divisions" value={partner.referral_divisions?.join(", ")} />
            <DetailRow label="Agreement" value={titleCase(partner.referral_agreement_type)} />
          </dl>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Visit History</h3>
          {visits.length === 0 ? (
            <p className="text-sm text-slate-400">No visits logged yet.</p>
          ) : (
            <ol className="space-y-2">
              {visits.slice(0, 10).map((v) => (
                <li key={v.id} className="rounded-lg border border-slate-100 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{formatDate(v.visit_date)}</span>
                    {v.spoke_to && <span className="text-xs text-slate-400">with {v.spoke_to}</span>}
                  </div>
                  {v.visit_notes && <p className="mt-1 text-sm text-slate-600">{v.visit_notes}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <ContactsPanel partnerId={partner.id} contacts={contacts} onChange={onChange} />
        </section>

        <section>
          <NotesPanel partnerId={partner.id} notes={notes} onChange={onChange} />
        </section>

        {partner.notes && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Profile Notes</h3>
            <p className="whitespace-pre-wrap text-sm text-slate-600">{partner.notes}</p>
          </section>
        )}
      </div>
    </Modal>
  );
}

// ===========================================================================
// Contacts management (inside detail dialog)
// ===========================================================================
function ContactsPanel({
  partnerId, contacts, onChange,
}: {
  partnerId: string;
  contacts: PartnerContact[];
  onChange: (msg: string) => void;
}) {
  const [editing, setEditing] = useState<PartnerContact | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    if (!confirm("Delete this contact?")) return;
    startTransition(async () => {
      const r = await deleteContact(id);
      onChange(r.ok ? r.message ?? "Contact deleted." : `Error: ${r.error}`);
    });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Contacts</h3>
        <button onClick={() => setEditing("new")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">+ Add Contact</button>
      </div>
      {contacts.length === 0 && editing == null ? (
        <p className="text-sm text-slate-400">No contacts recorded.</p>
      ) : (
        <ul className="space-y-2">
          {contacts.map((c) => (
            <li key={c.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{c.name}</span>
                    {c.is_primary && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Primary</span>}
                  </div>
                  {c.title && <div className="text-xs text-slate-500">{c.title}</div>}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
                    {c.email && <a className="text-emerald-700 hover:underline" href={`mailto:${c.email}`}>{c.email}</a>}
                    {c.phone && <a className="text-emerald-700 hover:underline" href={`tel:${c.phone}`}>{c.phone}</a>}
                    {c.preferred_contact_method && <span>Prefers {titleCase(c.preferred_contact_method)}</span>}
                  </div>
                  {c.relationship_notes && <p className="mt-1 text-xs text-slate-500">{c.relationship_notes}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => setEditing(c)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit">✎</button>
                  <button onClick={() => remove(c.id)} disabled={pending} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">🗑</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing != null && (
        <ContactForm
          partnerId={partnerId}
          contact={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); onChange(msg); }}
        />
      )}
    </div>
  );
}

function ContactForm({
  partnerId, contact, onClose, onSaved,
}: {
  partnerId: string;
  contact: PartnerContact | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await saveContact(formData);
      if (r.ok) onSaved(r.message ?? "Contact saved.");
      else setError(r.error);
    });
  }

  return (
    <form action={submit} className="mt-3 space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
      {contact && <input type="hidden" name="id" value={contact.id} />}
      <input type="hidden" name="partner_id" value={partnerId} />
      {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Name *</span>
          <input name="name" defaultValue={contact?.name ?? ""} className={fieldInput} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Title</span>
          <input name="title" defaultValue={contact?.title ?? ""} className={fieldInput} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Email</span>
          <input name="email" type="email" defaultValue={contact?.email ?? ""} className={fieldInput} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Phone</span>
          <input name="phone" defaultValue={contact?.phone ?? ""} className={fieldInput} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Preferred Contact Method</span>
          <select name="preferred_contact_method" defaultValue={contact?.preferred_contact_method ?? ""} className={fieldInput}>
            <option value="">—</option>
            {CONTACT_METHOD_OPTIONS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pt-6">
          <input type="checkbox" name="is_primary" defaultChecked={!!contact?.is_primary} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
          <span className="text-sm text-slate-700">Primary contact</span>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Relationship Notes</span>
        <textarea name="relationship_notes" rows={2} defaultValue={contact?.relationship_notes ?? ""} className={fieldInput} />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-white">Cancel</button>
        <button type="submit" disabled={pending} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

// ===========================================================================
// Notes management (inside detail dialog)
// ===========================================================================
function NotesPanel({
  partnerId, notes, onChange,
}: {
  partnerId: string;
  notes: PartnerNote[];
  onChange: (msg: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    if (!confirm("Delete this note?")) return;
    startTransition(async () => {
      const r = await deleteNote(id);
      onChange(r.ok ? r.message ?? "Note deleted." : `Error: ${r.error}`);
    });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</h3>
        <button onClick={() => setAdding((v) => !v)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">+ Add Note</button>
      </div>
      {adding && (
        <NoteForm
          partnerId={partnerId}
          onClose={() => setAdding(false)}
          onSaved={(msg) => { setAdding(false); onChange(msg); }}
        />
      )}
      {notes.length === 0 && !adding ? (
        <p className="text-sm text-slate-400">No notes yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {n.is_pinned && <span title="Pinned">📌</span>}
                    {n.category && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{titleCase(n.category)}</span>}
                    <span className="text-[11px] text-slate-400">{n.created_by_name || n.author_initials || "—"} · {formatDate(n.created_at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{n.content}</p>
                </div>
                <button onClick={() => remove(n.id)} disabled={pending} className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">🗑</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteForm({
  partnerId, onClose, onSaved,
}: {
  partnerId: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await saveNote(formData);
      if (r.ok) onSaved(r.message ?? "Note saved.");
      else setError(r.error);
    });
  }

  return (
    <form action={submit} className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
      <input type="hidden" name="partner_id" value={partnerId} />
      {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Note *</span>
        <textarea name="content" rows={3} className={fieldInput} placeholder="Add a note about this partner…" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Category</span>
          <select name="category" defaultValue="general" className={fieldInput}>
            {NOTE_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pt-6">
          <input type="checkbox" name="is_pinned" className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
          <span className="text-sm text-slate-700">Pin note</span>
        </label>
        <div className="ml-auto flex gap-2 pt-6">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-white">Cancel</button>
          <button type="submit" disabled={pending} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </form>
  );
}

// ===========================================================================
// Quick visit dialog
// ===========================================================================
function QuickVisitDialog({
  partner, partners, onClose, onSaved,
}: {
  partner: ReferralPartner | null;
  partners: ReferralPartner[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState<string[]>([]);
  const [partnerId, setPartnerId] = useState(partner?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const selected = partners.find((p) => p.id === partnerId) ?? partner;

  function toggle(v: string) {
    setItems((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  function submit(formData: FormData) {
    items.forEach((it) => formData.append("items_discussed", it));
    if (selected) formData.set("clinic_name", partnerName(selected));
    startTransition(async () => {
      const r = await logQuickVisit(formData);
      if (r.ok) onSaved(r.message ?? "Visit logged.");
      else setError(r.error);
    });
  }

  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
  const label = "text-xs font-medium text-slate-500";

  return (
    <Modal onClose={onClose}>
      <form action={submit}>
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-bold text-slate-900">Quick Visit</h2>
        </div>
        <div className="space-y-4 p-5">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={label}>Visit Date</span>
              <input name="visit_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Clinic / Partner</span>
              <select name="partner_id_select" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className={input}>
                <option value="">— Custom clinic —</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{partnerName(p)}</option>)}
              </select>
            </label>
            {!partnerId && (
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className={label}>Custom Clinic Name</span>
                <input name="clinic_name" className={input} placeholder="Clinic name" />
              </label>
            )}
            <input type="hidden" name="partner_id" value={partnerId} />
            <label className="flex flex-col gap-1">
              <span className={label}>Spoke With</span>
              <input name="spoke_to" className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Next Visit Date</span>
              <input name="next_visit_date" type="date" className={input} />
            </label>
          </div>
          <div>
            <span className={label}>Items Discussed</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {VISIT_ITEM_OPTIONS.map((o) => (
                <button key={o.value} type="button" onClick={() => toggle(o.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${items.includes(o.value) ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className={label}>Visit Notes</span>
            <textarea name="visit_notes" rows={3} className={input} />
          </label>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={pending} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {pending ? "Saving…" : "Save Visit"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ===========================================================================
// Upload dialog (EzyVet report)
// ===========================================================================
function UploadDialog({
  isAdmin, onClose, onDone,
}: {
  isAdmin: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function submit(formData: FormData) {
    setError(null);
    setResult(null);
    const f = formData.get("file");
    if (!(f instanceof File) || f.size === 0) { setError("Please choose a file."); return; }
    startTransition(async () => {
      const r = await parseReferralUpload(formData);
      if (r.success) { setResult(r); onDone(r.message); }
      else setError(r.message || r.error || "Upload failed.");
    });
  }

  return (
    <Modal onClose={onClose} wide>
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-bold text-slate-900">Upload EzyVet Report</h2>
        <p className="mt-0.5 text-xs text-slate-500">Referrer Revenue (.csv/.xls) or Referral Statistics (.csv). Auto-detected. Max 25 MB.</p>
      </div>
      <form action={submit} className="space-y-4 p-5">
        <input ref={fileRef} type="file" name="file" accept=".csv,.xls,.xlsx" className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-emerald-700" />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {result && result.success && (
          <div className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">{titleCase(result.reportType)}</span>
              <p className="text-sm font-medium text-emerald-800">{result.message}</p>
            </div>
            {result.dateRange && <p className="text-xs text-slate-500">Data range: {result.dateRange.start} → {result.dateRange.end}</p>}
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <Metric label="Partners Updated" value={result.updated ?? 0} />
              <Metric label="Referrals Added" value={result.visitorsAdded ?? 0} />
              <Metric label="Revenue Added" value={formatCurrency(result.revenueAdded)} />
              {result.newRows != null && <Metric label="New Rows" value={result.newRows} />}
              <Metric label="Duplicates Skipped" value={result.skipped ?? 0} />
              <Metric label="Not Matched" value={result.notMatched ?? 0} />
            </div>
            {result.overlapWarning && <p className="text-xs text-amber-700">{result.overlapWarning}</p>}
            {result.isDuplicateUpload && <p className="text-xs text-amber-700">This file appears to be a duplicate — all rows were already on file.</p>}
            {result.details && result.details.length > 0 && (
              <div>
                <button type="button" onClick={() => setShowDetails((s) => !s)} className="text-xs font-medium text-emerald-700 hover:underline">
                  {showDetails ? "Hide" : "Show"} per-clinic details ({result.details.length})
                </button>
                {showDetails && (
                  <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-slate-100">
                        {result.details.map((d, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5 text-slate-700">{d.clinicName}</td>
                            <td className="px-3 py-1.5">{d.matched ? <span className="text-emerald-600">→ {d.matchedTo}</span> : <span className="text-amber-600">unmatched</span>}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{d.visits}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(d.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!isAdmin && <p className="text-xs text-slate-400">Tip: admins can undo individual revenue uploads from the Upload Log tab.</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Close</button>
          <button type="submit" disabled={pending} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {pending ? "Processing…" : "Upload & Parse"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-white p-2 ring-1 ring-slate-100">
      <div className="text-sm font-semibold text-slate-800">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}
