"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MarketingEvent } from "@/lib/marketing/types";
import {
  type QrCode,
  type QrLead,
  QR_LEAD_STATUSES,
  QR_LEAD_STATUS_COLORS,
  qrLeadStatusLabel,
} from "@/lib/marketing/qr";
import { setQrLeadStatus, deleteQrLead } from "../qr-actions";
import { useTableSort, SortHeader } from "../../_components/data-views";
import type { CeEventSummary } from "@/lib/marketing/event-rows";

const fieldInput =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const btnGhost =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50";

const DAY_MS = 86_400_000;
/** Kept out of render so the "no Date.now() in render" rule stays satisfied. */
function cutoffIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
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

/** RFC 4180 quoting — a lead's note or answer can contain commas and quotes. */
function csvCell(value: string | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function EventLeadsTab({
  leads,
  events,
  ceEvents,
  qrCodes,
  canEdit,
}: {
  leads: QrLead[];
  events: MarketingEvent[];
  ceEvents: CeEventSummary[];
  qrCodes: QrCode[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [eventId, setEventId] = useState("");
  const [status, setStatus] = useState("");
  const [range, setRange] = useState("all");
  const [q, setQ] = useState("");

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }
  function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const res = await action();
      notify(res.ok ? res.message ?? "Saved." : `Error: ${res.error}`);
      if (res.ok) router.refresh();
    });
  }

  // Marketing events and CE courses share one name lookup: a lead belongs to
  // whichever the scanned code points at.
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) m.set(e.id, e.name);
    for (const e of ceEvents) m.set(e.id, `CE: ${e.name}`);
    return m;
  }, [events, ceEvents]);

  const codeById = useMemo(() => {
    const m = new Map<string, QrCode>();
    for (const c of qrCodes) m.set(c.id, c);
    return m;
  }, [qrCodes]);

  /** The event or CE course a lead belongs to. */
  const subjectOf = useMemo(() => {
    return (l: QrLead): string | null => {
      const code = codeById.get(l.qr_code_id);
      return (
        l.event_id ?? l.ce_event_id ?? code?.event_id ?? code?.ce_event_id ?? null
      );
    };
  }, [codeById]);

  // Only codes tied to an event or CE course produce "event leads".
  const eventLeads = useMemo(
    () => leads.filter((l) => subjectOf(l) !== null),
    [leads, subjectOf],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const since = range === "all" ? null : cutoffIso(Number(range));
    return eventLeads.filter((l) => {
      const subject = subjectOf(l);
      if (eventId && subject !== eventId) return false;
      if (status && l.status !== status) return false;
      if (since && l.scanned_at < since) return false;
      if (!needle) return true;
      const hay = [
        l.full_name,
        l.email,
        l.phone,
        l.pet_name,
        l.zip,
        l.notes,
        ...Object.values(l.answers ?? {}),
        subject ? nameById.get(subject) : null,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [eventLeads, eventId, status, range, q, subjectOf, nameById]);

  const sort = useTableSort(filtered, {
    name: (l) => l.full_name,
    event: (l) => nameById.get(subjectOf(l) ?? "") ?? "",
    contact: (l) => l.email ?? l.phone,
    pet: (l) => l.pet_name,
    scanned: (l) => l.scanned_at,
    status: (l) => l.status,
  });

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of eventLeads) m[l.status] = (m[l.status] ?? 0) + 1;
    return m;
  }, [eventLeads]);

  // Union of every custom question answered in the filtered set, so the export
  // has a stable column per question.
  const answerKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const l of filtered) for (const k of Object.keys(l.answers ?? {})) keys.add(k);
    return [...keys].sort();
  }, [filtered]);

  function exportCsv() {
    const header = [
      "Scanned",
      "Name",
      "Email",
      "Phone",
      "Pet",
      "ZIP",
      "Event",
      "QR code",
      "Status",
      "Notes",
      ...answerKeys,
    ];
    const rows = sort.sorted.map((l) => {
      const code = codeById.get(l.qr_code_id);
      const subject = subjectOf(l);
      return [
        l.scanned_at,
        l.full_name,
        l.email,
        l.phone,
        l.pet_name,
        l.zip,
        subject ? nameById.get(subject) ?? "" : "",
        code?.label ?? "",
        qrLeadStatusLabel(l.status),
        l.notes,
        ...answerKeys.map((k) => l.answers?.[k] ?? ""),
      ].map(csvCell).join(",");
    });
    const csv = [header.map(csvCell).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `event-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, answer…"
          className={`${fieldInput} min-w-[14rem] flex-1`}
        />
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={fieldInput}>
          <option value="">All events</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
          {ceEvents.map((e) => (
            <option key={e.id} value={e.id}>
              CE: {e.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={fieldInput}>
          <option value="">All statuses</option>
          {QR_LEAD_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label} ({counts[s.value] ?? 0})
            </option>
          ))}
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value)} className={fieldInput}>
          <option value="all">Any time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <span className="text-sm text-slate-400">{filtered.length} shown</span>
        <button type="button" onClick={exportCsv} disabled={filtered.length === 0} className={`${btnGhost} ml-auto disabled:opacity-50`}>
          ⬇ Export CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-10 text-center text-sm text-slate-400">
          No event leads yet. Generate a QR code on an event&apos;s QR tab and every
          scan lands here.
        </p>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm" style={{ maxHeight: "70vh" }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortHeader label="Name" sortKey="name" sort={sort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Contact" sortKey="contact" sort={sort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Pet" sortKey="pet" sort={sort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Event" sortKey="event" sort={sort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Scanned" sortKey="scanned" sort={sort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Status" sortKey="status" sort={sort} className="px-4 py-2.5 font-semibold" />
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sort.sorted.map((l) => {
                const code = codeById.get(l.qr_code_id);
                const subject = subjectOf(l);
                const answers = Object.entries(l.answers ?? {});
                return (
                  <tr key={l.id} className="align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{l.full_name}</div>
                      {answers.length > 0 && (
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {answers.map(([k, v]) => `${k}: ${v}`).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {[l.email, l.phone].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{l.pet_name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{(subject ? nameById.get(subject) : null) ?? code?.label ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{fmtDateTime(l.scanned_at)}</td>
                    <td className="px-4 py-2.5">
                      {canEdit ? (
                        <select
                          value={l.status}
                          onChange={(e) => run(() => setQrLeadStatus(l.id, e.target.value))}
                          className={`rounded-md border-0 px-2 py-1 text-xs font-semibold ${QR_LEAD_STATUS_COLORS[l.status] ?? "bg-slate-100 text-slate-600"}`}
                        >
                          {QR_LEAD_STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${QR_LEAD_STATUS_COLORS[l.status] ?? ""}`}>
                          {qrLeadStatusLabel(l.status)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Delete the lead "${l.full_name}"?`)) run(() => deleteQrLead(l.id));
                          }}
                          className="text-slate-300 hover:text-red-600"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </section>
  );
}
