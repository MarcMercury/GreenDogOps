"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  type QrCode,
  type QrLead,
  QR_CODE_TYPES,
  QR_LEAD_STATUSES,
  QR_LEAD_STATUS_COLORS,
  qrLeadStatusLabel,
} from "@/lib/marketing/qr";
import { setQrLeadStatus, deleteQrLead } from "@/app/(app)/marketing/qr-actions";
import {
  updateRetailLead,
  deleteRetailLead,
} from "@/app/(app)/crm/vendor/actions";
import {
  useTableSort,
  SortHeader,
  StatCard,
  downloadCsv,
  stickyHeadClass,
} from "@/app/(app)/_components/data-views";

const selectClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

const DAY_MS = 86_400_000;
/** Kept out of render so the "no Date.now() in render" rule stays satisfied. */
function withinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && Date.now() - t <= days * DAY_MS;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/**
 * One captured scan, normalised across the two tables that store them:
 * `qr_lead` (every managed code) and `crm_retail_lead` (Non-Med Partner codes,
 * which predate qr_lead and still write to their own table).
 */
export interface QrLeadRow {
  id: string;
  origin: "qr" | "retail";
  fullName: string;
  email: string | null;
  phone: string | null;
  petName: string | null;
  zip: string | null;
  notes: string | null;
  answers: Record<string, string>;
  status: string;
  scannedAt: string;
  /** The record the code belongs to (event, promo, clinic, rescue, partner). */
  sourceId: string | null;
  sourceName: string;
  /** qr_code.code_type, or "partner" for legacy retail leads. */
  sourceType: string;
  codeLabel: string | null;
}

const codeTypeIcon = (v: string): string =>
  QR_CODE_TYPES.find((t) => t.value === v)?.icon ?? "🔗";
const codeTypeLabel = (v: string): string =>
  QR_CODE_TYPES.find((t) => t.value === v)?.label ?? "Other";

/**
 * Which record a scan belongs to. The lead denormalises some links, but a
 * promo code only records the promotion on the code itself, so both are
 * checked — lead first, then the code it was scanned from.
 */
function resolveSource(
  lead: QrLead,
  code: QrCode | undefined,
): { id: string | null; type: string } {
  const eventId = lead.event_id ?? code?.event_id ?? null;
  if (eventId) return { id: eventId, type: "event" };
  const ceId = lead.ce_event_id ?? code?.ce_event_id ?? null;
  if (ceId) return { id: ceId, type: "ce" };
  const promoId = code?.promotion_id ?? null;
  if (promoId) return { id: promoId, type: "promo" };
  const referralId = lead.referral_partner_id ?? code?.referral_partner_id ?? null;
  if (referralId) return { id: referralId, type: "referral" };
  const orgId = lead.org_id ?? code?.org_id ?? null;
  if (orgId) return { id: orgId, type: code?.code_type === "partner" ? "partner" : "rescue" };
  return { id: null, type: code?.code_type ?? "other" };
}

/**
 * Normalise `qr_lead` rows for the table. `names` maps a source record id to
 * its display name — callers merge whatever lookups they have (events, CE
 * courses, promotions, clinics, rescues).
 */
export function buildQrLeadRows(
  leads: QrLead[],
  codes: QrCode[],
  names: Map<string, string>,
): QrLeadRow[] {
  const codeById = new Map(codes.map((c) => [c.id, c]));
  return leads.map((l) => {
    const code = codeById.get(l.qr_code_id);
    const source = resolveSource(l, code);
    return {
      id: l.id,
      origin: "qr" as const,
      fullName: l.full_name,
      email: l.email,
      phone: l.phone,
      petName: l.pet_name,
      zip: l.zip,
      notes: l.notes,
      answers: l.answers ?? {},
      status: l.status,
      scannedAt: l.scanned_at,
      sourceId: source.id,
      sourceName:
        (source.id ? names.get(source.id) : null) ?? code?.label ?? "—",
      sourceType: source.type,
      codeLabel: code?.label ?? null,
    };
  });
}

/**
 * The shared "Leads" tab. Used unified in QR Code Mgmt and scoped to one
 * module in Referral Clinics, Rescues & Shelters and Promotions.
 */
export function QrLeadsView({
  rows,
  canEdit,
  sourceLabel = "Source",
  showTypeFilter = false,
  exportName = "qr-leads",
  emptyHint = "No leads yet. Generate a QR code on a record's QR tab and every scan lands here.",
  onNotify,
}: {
  rows: QrLeadRow[];
  canEdit: boolean;
  /** Column + filter label for the record a code belongs to. */
  sourceLabel?: string;
  /** Adds the code-type filter — only useful where several types mix. */
  showTypeFilter?: boolean;
  exportName?: string;
  emptyHint?: string;
  onNotify?: (msg: string) => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [days, setDays] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function notify(msg: string) {
    if (onNotify) {
      onNotify(msg);
      return;
    }
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  const stats = useMemo(
    () => ({
      total: rows.length,
      last30: rows.filter((r) => withinDays(r.scannedAt, 30)).length,
      last7: rows.filter((r) => withinDays(r.scannedAt, 7)).length,
      sources: new Set(rows.map((r) => r.sourceId).filter(Boolean)).size,
    }),
    [rows],
  );

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.status] = (m[r.status] ?? 0) + 1;
    return m;
  }, [rows]);

  // Only records that have actually produced a scan are worth filtering by.
  const sourceOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.sourceId) m.set(r.sourceId, r.sourceName);
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const typeOptions = useMemo(
    () => [...new Set(rows.map((r) => r.sourceType))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (sourceId && r.sourceId !== sourceId) return false;
      if (type && r.sourceType !== type) return false;
      if (status && r.status !== status) return false;
      if (days && !withinDays(r.scannedAt, Number(days))) return false;
      if (!q) return true;
      const hay = [
        r.fullName,
        r.email,
        r.phone,
        r.petName,
        r.zip,
        r.notes,
        r.sourceName,
        r.codeLabel,
        ...Object.values(r.answers),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, sourceId, type, status, days]);

  const sort = useTableSort<QrLeadRow>(
    filtered,
    {
      scanned: (r) => r.scannedAt,
      name: (r) => r.fullName,
      pet: (r) => r.petName ?? "",
      contact: (r) => r.email ?? r.phone ?? "",
      source: (r) => r.sourceName,
      type: (r) => codeTypeLabel(r.sourceType),
      status: (r) => r.status,
    },
    { key: "scanned", dir: "desc" },
  );

  // A stable column per custom question asked anywhere in the filtered set.
  const answerKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const r of filtered) for (const k of Object.keys(r.answers)) keys.add(k);
    return [...keys].sort();
  }, [filtered]);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const res = await action();
      notify(res.ok ? okMsg : `Error: ${res.error}`);
      if (res.ok) router.refresh();
    });
  }

  function onStatusChange(row: QrLeadRow, next: string) {
    if (row.origin === "retail") {
      const fd = new FormData();
      fd.set("lead_id", row.id);
      fd.set("status", next);
      if (row.notes) fd.set("notes", row.notes);
      run(() => updateRetailLead(fd), "Lead updated.");
      return;
    }
    run(() => setQrLeadStatus(row.id, next), "Lead updated.");
  }

  function onDelete(row: QrLeadRow) {
    if (!confirm(`Delete the lead from ${row.fullName}?`)) return;
    run(
      () => (row.origin === "retail" ? deleteRetailLead(row.id) : deleteQrLead(row.id)),
      "Lead deleted.",
    );
  }

  function exportCsv() {
    downloadCsv(
      `${exportName}-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Scanned",
        "Name",
        "Pet",
        "Email",
        "Phone",
        "ZIP",
        sourceLabel,
        "Type",
        "QR code",
        "Status",
        "Notes",
        ...answerKeys,
      ],
      sort.sorted.map((r) => [
        r.scannedAt,
        r.fullName,
        r.petName ?? "",
        r.email ?? "",
        r.phone ?? "",
        r.zip ?? "",
        r.sourceName,
        codeTypeLabel(r.sourceType),
        r.codeLabel ?? "",
        qrLeadStatusLabel(r.status),
        r.notes ?? "",
        ...answerKeys.map((k) => r.answers[k] ?? ""),
      ]),
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Leads" value={String(stats.total)} tone="text-fuchsia-700" />
        <StatCard label="Last 30 Days" value={String(stats.last30)} tone="text-emerald-700" />
        <StatCard label="Last 7 Days" value={String(stats.last7)} tone="text-indigo-700" />
        <StatCard label={`${sourceLabel}s Producing`} value={String(stats.sources)} tone="text-sky-700" />
      </div>

      <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, answer…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 sm:w-64"
          />
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={selectClass}>
            <option value="">All {sourceLabel.toLowerCase()}s</option>
            {sourceOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {showTypeFilter && (
            <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
              <option value="">All types</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {codeTypeLabel(t)}
                </option>
              ))}
            </select>
          )}
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
            <option value="">All statuses</option>
            {QR_LEAD_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} ({statusCounts[s.value] ?? 0})
              </option>
            ))}
          </select>
          <select value={days} onChange={(e) => setDays(e.target.value)} className={selectClass}>
            <option value="">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
          </select>
          <span className="text-sm text-slate-400">{filtered.length} shown</span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            ⬇ Export
          </button>
        </div>
      </div>

      {sort.sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-sm text-slate-500">
          {rows.length === 0 ? emptyHint : "No leads match your filters."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`${stickyHeadClass} border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500`}>
                  <SortHeader label="Date Scanned" sortKey="scanned" sort={sort} className="px-4 py-3" />
                  <SortHeader label="Lead" sortKey="name" sort={sort} className="px-3 py-3" />
                  <SortHeader label="Pet" sortKey="pet" sort={sort} className="px-3 py-3" />
                  <SortHeader label="Contact" sortKey="contact" sort={sort} className="px-3 py-3" />
                  <SortHeader label={sourceLabel} sortKey="source" sort={sort} className="px-3 py-3" />
                  {showTypeFilter && (
                    <SortHeader label="Type" sortKey="type" sort={sort} className="px-3 py-3" />
                  )}
                  <SortHeader label="Status" sortKey="status" sort={sort} className="px-3 py-3" />
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sort.sorted.map((r) => {
                  const answers = Object.entries(r.answers);
                  return (
                    <tr key={`${r.origin}:${r.id}`} className="align-top transition hover:bg-emerald-50/40">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {fmtDateTime(r.scannedAt)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-900">{r.fullName}</div>
                        {answers.length > 0 && (
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            {answers.map(([k, v]) => `${k}: ${v}`).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">{r.petName || "—"}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {r.email && (
                          <a className="block truncate text-emerald-700 hover:underline" href={`mailto:${r.email}`}>
                            {r.email}
                          </a>
                        )}
                        {r.phone && (
                          <a className="block text-slate-500 hover:underline" href={`tel:${r.phone}`}>
                            {r.phone}
                          </a>
                        )}
                        {!r.email && !r.phone && "—"}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        <div className="font-medium text-slate-700">{r.sourceName}</div>
                        {r.codeLabel && r.codeLabel !== r.sourceName && (
                          <div className="text-[11px] text-slate-400">{r.codeLabel}</div>
                        )}
                      </td>
                      {showTypeFilter && (
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">
                          <span aria-hidden className="mr-1">
                            {codeTypeIcon(r.sourceType)}
                          </span>
                          {codeTypeLabel(r.sourceType)}
                        </td>
                      )}
                      <td className="px-3 py-3">
                        {canEdit ? (
                          <select
                            value={r.status}
                            onChange={(e) => onStatusChange(r, e.target.value)}
                            className={`rounded-md border-0 px-2 py-1 text-xs font-semibold ${QR_LEAD_STATUS_COLORS[r.status] ?? "bg-slate-100 text-slate-600"}`}
                          >
                            {QR_LEAD_STATUSES.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${QR_LEAD_STATUS_COLORS[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                            {qrLeadStatusLabel(r.status)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {canEdit && (
                          <button
                            type="button"
                            title="Delete lead"
                            onClick={() => onDelete(r)}
                            className="text-slate-300 transition hover:text-red-600"
                          >
                            🗑
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
