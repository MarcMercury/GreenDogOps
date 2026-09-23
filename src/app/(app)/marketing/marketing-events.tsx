"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { QRCodeCanvas } from "qrcode.react";
import {
  type MarketingEvent,
  type MarketingEventSource,
  type MarketingEventAttendee,
  type ChecklistItem,
  type PackingListItem,
  type CrmOrgRef,
  type PersonOption,
  type EventStaffShift,
  EVENT_TYPES,
  EVENT_STATUSES,
  ATTENDEE_TYPES,
  VENUE_TYPES,
  PACKING_STATUSES,
  PACKING_STATUS_STYLES,
  attendeeTypeLabel,
  personLabel,
} from "@/lib/marketing/types";
import {
  type QrCode,
  type QrForm,
  type QrFormField,
  QR_FIELD_TYPES,
  qrScanUrl,
  slugifyFieldKey,
} from "@/lib/marketing/qr";
import {
  type CeEventSummary,
  type UnifiedEvent,
  buildUnifiedEvents,
} from "@/lib/marketing/event-rows";
import { CeEventDialog } from "./ce-event-dialog";
import {
  saveEvent,
  deleteEvent,
  saveEventSource,
  deleteEventSource,
  markSourceChecked,
  createEventFromSource,
  saveAttendee,
  deleteAttendee,
  syncSourceToCrm,
  syncAllSourcesToCrm,
  linkSourceToCrm,
  lookupEventStaffShifts,
  type ActionResult,
} from "./actions";
import {
  createQrCodeFor,
  saveQrForm,
  saveQrCode,
  setQrCodeActive,
  deleteQrCode,
} from "./qr-actions";
import { useTableSort, SortHeader, stickyHeadClass } from "../_components/data-views";
import { PhoneInput } from "@/lib/shared/phone-input";
import { OwnerSelect } from "./owner-select";

const fieldInput =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const fieldLabel = "mb-1 block text-xs font-medium text-slate-500";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50";
const btnGhost =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50";

const STATUS_COLORS: Record<string, string> = {
  idea: "bg-slate-100 text-slate-600",
  researching: "bg-slate-100 text-slate-600",
  tentative: "bg-sky-50 text-sky-700",
  planning: "bg-amber-50 text-amber-700",
  prepping: "bg-violet-50 text-violet-700",
  confirmed: "bg-emerald-50 text-emerald-700",
  completed: "bg-indigo-50 text-indigo-700",
  cancelled: "bg-red-50 text-red-700",
};

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 === 0 ? 0 : 2 });
}
function fmtNum(n: number | null | undefined) {
  return n == null ? "—" : n.toLocaleString("en-US");
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "Date TBD";
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function daysAgo(d: string | null): number | null {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  if (isNaN(dt.getTime())) return null;
  return Math.floor((Date.now() - dt.getTime()) / 86_400_000);
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${className ?? "bg-slate-100 text-slate-600"}`}>
      {children}
    </span>
  );
}

export type Run = (action: () => Promise<ActionResult>, after?: () => void) => void;

// ===========================================================================
export function EventsTab({
  canEdit,
  events,
  ceEvents,
  sources,
  attendees,
  crmOrgs,
  people,
  qrCodes,
  qrForms,
}: {
  canEdit: boolean;
  events: MarketingEvent[];
  ceEvents: CeEventSummary[];
  sources: MarketingEventSource[];
  attendees: MarketingEventAttendee[];
  crmOrgs: CrmOrgRef[];
  people: PersonOption[];
  qrCodes: QrCode[];
  qrForms: QrForm[];
}) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<MarketingEvent | "new" | null>(null);
  const [viewingCe, setViewingCe] = useState<CeEventSummary | null>(null);
  const [editingSource, setEditingSource] = useState<MarketingEventSource | "new" | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [view, setView] = useState<"all" | "upcoming" | "past">("all");
  const [kind, setKind] = useState<"all" | "marketing" | "ce">("all");

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }
  const run: Run = (action, after) => {
    startTransition(async () => {
      const res = await action();
      notify(res.ok ? res.message ?? "Saved." : `Error: ${res.error}`);
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  };

  const today = new Date().toISOString().slice(0, 10);
  const { upcoming, past } = useMemo(() => {
    const all = buildUnifiedEvents(events, ceEvents).filter(
      (e) => kind === "all" || e.kind === kind,
    );
    const up: UnifiedEvent[] = [];
    const pa: UnifiedEvent[] = [];
    for (const e of all) {
      const isPast =
        e.status === "completed" ||
        e.status === "cancelled" ||
        (e.startsOn != null && e.startsOn < today);
      (isPast ? pa : up).push(e);
    }
    up.sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""));
    pa.sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""));
    return { upcoming: up, past: pa };
  }, [events, ceEvents, kind, today]);

  const attendeesByEvent = useMemo(() => {
    const m = new Map<string, MarketingEventAttendee[]>();
    for (const a of attendees) {
      const list = m.get(a.event_id) ?? [];
      list.push(a);
      m.set(a.event_id, list);
    }
    return m;
  }, [attendees]);

  const orgById = useMemo(() => {
    const m = new Map<string, CrmOrgRef>();
    for (const o of crmOrgs) m.set(o.id, o);
    return m;
  }, [crmOrgs]);
  const unlinkedCount = sources.filter((s) => !s.crm_organization_id).length;

  const sourceSort = useTableSort(sources, {
    vendor: (s) => s.name,
    calendar: (s) => s.url,
    region: (s) => s.region,
    cost: (s) => s.membership_cost,
    lastChecked: (s) => s.last_checked_on,
    notes: (s) => s.notes,
  });

  const eventRows = view === "upcoming" ? upcoming : view === "past" ? past : [...upcoming, ...past];
  const eventSort = useTableSort(eventRows, {
    event: (e) => e.name,
    date: (e) => e.startsOn,
    type: (e) => e.typeLabel,
    status: (e) => e.statusLabel,
    owner: (e) => e.ownerName,
    location: (e) => e.location,
    promo: (e) => (e.hasPromo ? 1 : 0),
    cost: (e) => e.cost,
    attendees: (e) => e.attendees ?? (attendeesByEvent.get(e.id)?.length ?? 0),
  });

  return (
    <section className="space-y-5">
      {/* Event sources */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <button type="button" onClick={() => setShowSources((v) => !v)} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span aria-hidden className={`transition-transform ${showSources ? "" : "-rotate-90"}`}>⌄</span>
            🔎 Event sources to scout ({sources.length})
            {!showSources && <span className="font-normal text-slate-400">— Expand to search for local events</span>}
          </button>
          {canEdit && (
            <div className="flex items-center gap-1.5">
              {unlinkedCount > 0 && (
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => run(() => syncAllSourcesToCrm())}
                  title="Create or link a Vendor & Partner CRM record for every source"
                >
                  🤝 Sync {unlinkedCount} to CRM
                </button>
              )}
              <button type="button" className={btnGhost} onClick={() => setEditingSource("new")}>+ Source</button>
            </div>
          )}
        </div>
        {showSources && (
          <div className="max-h-[70vh] overflow-auto border-t border-slate-100">
            {sources.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">No sources yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className={`${stickyHeadClass} text-left text-xs uppercase tracking-wide text-slate-500`}>
                  <tr>
                    <SortHeader label="Vendor / Partner" sortKey="vendor" sort={sourceSort} className="px-4 py-2 font-semibold" />
                    <SortHeader label="Calendar" sortKey="calendar" sort={sourceSort} className="px-4 py-2 font-semibold" />
                    <SortHeader label="Region" sortKey="region" sort={sourceSort} className="px-4 py-2 font-semibold" />
                    <SortHeader label="Cost" sortKey="cost" sort={sourceSort} className="px-4 py-2 font-semibold" />
                    <SortHeader label="Last checked" sortKey="lastChecked" sort={sourceSort} className="px-4 py-2 font-semibold" />
                    <SortHeader label="Notes" sortKey="notes" sort={sourceSort} className="px-4 py-2 font-semibold" />
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sourceSort.sorted.map((s) => {
                    const d = daysAgo(s.last_checked_on);
                    const stale = d == null || d > 31;
                    return (
                      <tr key={s.id} className="align-top">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900">
                            {s.crm_organization_id ? (
                              <Link
                                href={`/crm/org/${s.crm_organization_id}`}
                                className="text-emerald-700 hover:underline"
                                title={`Open ${orgById.get(s.crm_organization_id)?.name ?? s.name} in the Vendor & Partner CRM`}
                              >
                                {s.name}
                              </Link>
                            ) : (
                              <span className="inline-flex items-center gap-2">
                                {s.name}
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => run(() => syncSourceToCrm(s.id))}
                                    className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                                    title="Create or link a Vendor & Partner CRM record"
                                  >
                                    + Link CRM
                                  </button>
                                )}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {s.url ? (
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">
                              Calendar ↗
                            </a>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{s.region ?? "—"}</td>
                        <td className="px-4 py-2.5 text-slate-600">{s.membership_cost ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className={stale ? "text-amber-600" : "text-slate-500"}>
                            {s.last_checked_on ? `${fmtDate(s.last_checked_on)}${d != null ? ` (${d}d)` : ""}` : "never"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{s.notes ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {canEdit && (
                            <div className="flex justify-end gap-1.5">
                              <button type="button" onClick={() => run(() => markSourceChecked(s.id))} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" title="Mark checked today">✓ Checked</button>
                              <button type="button" onClick={() => run(() => createEventFromSource(s.id, s.name))} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100" title="Create an event from this source">+ Event</button>
                              <button type="button" onClick={() => setEditingSource(s)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">Edit</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Scout a source → create an event → plan, promote &amp; staff it → recap the results.</p>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
            {(["all", "marketing", "ce"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`px-3 py-1.5 text-xs font-medium transition ${kind === k ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {k === "all" ? "All events" : k === "marketing" ? "Marketing" : "CE courses"}
              </button>
            ))}
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
            {(["all", "upcoming", "past"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition ${view === v ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {v}
              </button>
            ))}
          </div>
          {canEdit && <button type="button" className={btnPrimary} onClick={() => setEditing("new")}>+ Event</button>}
        </div>
      </div>

      {(() => {
        const rows = eventSort.sorted;
        if (rows.length === 0) return <Empty label="No events." />;
        return (
          <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm" style={{ maxHeight: "70vh" }}>
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-20 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <SortHeader label="Event" sortKey="event" sort={eventSort} className="sticky left-0 z-30 bg-slate-50 px-4 py-2.5 font-semibold" />
                  <SortHeader label="Date" sortKey="date" sort={eventSort} className="px-4 py-2.5 font-semibold" />
                  <SortHeader label="Type" sortKey="type" sort={eventSort} className="px-4 py-2.5 font-semibold" />
                  <SortHeader label="Status" sortKey="status" sort={eventSort} className="px-4 py-2.5 font-semibold" />
                  <SortHeader label="Owner" sortKey="owner" sort={eventSort} className="px-4 py-2.5 font-semibold" />
                  <SortHeader label="Location" sortKey="location" sort={eventSort} className="px-4 py-2.5 font-semibold" />
                  <SortHeader label="Promo" sortKey="promo" sort={eventSort} className="px-4 py-2.5 font-semibold" />
                  <SortHeader label="Cost" sortKey="cost" sort={eventSort} align="right" className="px-4 py-2.5 font-semibold" />
                  <SortHeader label="Attendees" sortKey="attendees" sort={eventSort} align="right" className="px-4 py-2.5 font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((e) => {
                  const att = (attendeesByEvent.get(e.id) ?? []).length;
                  const isCe = e.kind === "ce";
                  return (
                    <tr
                      key={e.key}
                      className="group cursor-pointer transition hover:bg-emerald-50/40"
                      onClick={() => {
                        if (isCe) setViewingCe(e.ce);
                        else if (canEdit) setEditing(e.marketing);
                      }}
                    >
                      <td className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium text-slate-900 group-hover:bg-emerald-50/40">
                        <span className="mr-1.5" aria-hidden>{isCe ? "📋" : "🎪"}</span>
                        {e.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fmtDate(e.startsOn)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <Badge className={isCe ? "bg-indigo-50 text-indigo-700" : undefined}>{e.typeLabel}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5"><Badge className={STATUS_COLORS[e.status]}>{e.statusLabel}</Badge></td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{e.ownerName ?? "—"}</td>
                      <td className="max-w-[14rem] truncate px-4 py-2.5 text-slate-600" title={e.location ?? undefined}>{e.location ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {e.hasPromo ? (
                          <Badge className="bg-emerald-50 text-emerald-700" >Yes</Badge>
                        ) : (
                          <span className="text-xs text-slate-400">No</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-600">{e.cost != null ? fmtMoney(e.cost) : "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-600">{fmtNum(e.attendees ?? (isCe ? null : att || null))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}

      {editing && (
        <EventDialog
          event={editing === "new" ? null : editing}
          sources={sources}
          attendees={editing === "new" ? [] : attendeesByEvent.get(editing.id) ?? []}
          canEdit={canEdit}
          people={people}
          qrCodes={qrCodes}
          qrForms={qrForms}
          onClose={() => setEditing(null)}
          run={run}
        />
      )}
      {viewingCe && (
        <CeEventDialog
          event={viewingCe}
          qrCodes={qrCodes}
          qrForms={qrForms}
          canEdit={canEdit}
          onClose={() => setViewingCe(null)}
          run={run}
        />
      )}
      {editingSource && (
        <SourceDialog
          source={editingSource === "new" ? null : editingSource}
          crmOrgs={crmOrgs}
          canEdit={canEdit}
          onClose={() => setEditingSource(null)}
          run={run}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">{toast}</div>
      )}
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-8 text-center text-sm text-slate-400">{label}</p>;
}

function OptionsSelect({ name, defaultValue, options, placeholder }: { name: string; defaultValue?: string; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} className={fieldInput}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Event dialog with Details / Planning / Recap / Attendees
// ---------------------------------------------------------------------------
export function EventDialog({ event, defaultDate, sources, attendees, canEdit, people, qrCodes, qrForms, onClose, run }: {
  event: MarketingEvent | null;
  /** Pre-fills the start date when creating from a calendar day cell. */
  defaultDate?: string | null;
  sources: MarketingEventSource[];
  attendees: MarketingEventAttendee[];
  canEdit: boolean;
  people: PersonOption[];
  qrCodes?: QrCode[];
  qrForms?: QrForm[];
  onClose: () => void;
  run: Run;
}) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>(event?.checklist ?? []);
  const [newCheck, setNewCheck] = useState("");
  // Materials are a single flat list now — items are added one at a time.
  const [materials, setMaterials] = useState<PackingListItem[]>(
    () => (event?.packing_list ?? []).flatMap((g) => g.items),
  );
  const [staffIds, setStaffIds] = useState<string[]>(() => event?.staff_ids ?? []);
  const [hasPromo, setHasPromo] = useState(event?.has_promo ?? false);
  const [startsOn, setStartsOn] = useState(event?.starts_on ?? defaultDate ?? "");
  const [endsOn, setEndsOn] = useState(event?.ends_on ?? "");
  const [tab, setTab] = useState<"details" | "planning" | "materials" | "qr" | "recap">("details");

  const TABS = [
    { key: "details", label: "Details" },
    { key: "planning", label: "Planning & promotion" },
    { key: "materials", label: "Materials" },
    { key: "qr", label: "QR code" },
    { key: "recap", label: "Recap" },
  ] as const;

  const eventQrCodes = useMemo(
    () => (event ? (qrCodes ?? []).filter((c) => c.event_id === event.id) : []),
    [qrCodes, event],
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveEvent(fd), onClose);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">{event ? "Edit event" : "New event"}</h2>
          <div className="flex items-center gap-2">
            <button type="submit" form="event-form" className={btnPrimary}>Save</button>
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">✕</button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200 px-5 pt-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === t.key
                  ? "border-emerald-600 text-emerald-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form id="event-form" onSubmit={onSubmit} className="max-h-[72vh] space-y-5 overflow-y-auto px-5 py-4">
          {event && <input type="hidden" name="id" value={event.id} />}
          {/* hidden checklist mirrors */}
          {checklist.map((c, i) => (
            <span key={`h-${i}`}>
              <input type="hidden" name="check_label" value={c.label} />
              <input type="hidden" name="check_done" value={String(c.done)} />
            </span>
          ))}
          {/* serialized packing / material list */}
          <input
            type="hidden"
            name="packing_list_json"
            value={JSON.stringify(materials.length ? [{ group: "Materials", items: materials }] : [])}
          />
          {/* structured staff roster + the rendered names the rest of the app reads */}
          {staffIds.map((id) => (
            <input key={`s-${id}`} type="hidden" name="staff_id" value={id} />
          ))}
          <input
            type="hidden"
            name="staff"
            value={staffIds
              .map((id) => people.find((p) => p.id === id))
              .filter(Boolean)
              .map((p) => personLabel(p as PersonOption))
              .join(", ")}
          />

          {/* Details */}
          <div className={tab === "details" ? "space-y-5" : "hidden"}>
          <div>
            <label className={fieldLabel}>Event name</label>
            <input name="name" defaultValue={event?.name ?? ""} required className={fieldInput} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className={fieldLabel}>Type</label><OptionsSelect name="event_type" defaultValue={event?.event_type ?? "third_party"} options={EVENT_TYPES} /></div>
            <div><label className={fieldLabel}>Status</label><OptionsSelect name="status" defaultValue={event?.status ?? "researching"} options={EVENT_STATUSES} /></div>
            <div><label className={fieldLabel}>Start date</label><input type="date" name="starts_on" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={fieldInput} /></div>
            <div><label className={fieldLabel}>End date</label><input type="date" name="ends_on" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={fieldInput} /></div>
            <div><label className={fieldLabel}>Owner</label><OwnerSelect name="owner_name" people={people} defaultValue={event?.owner_name ?? ""} className={fieldInput} /></div>
            <div><label className={fieldLabel}>Location</label><input name="location" defaultValue={event?.location ?? ""} className={fieldInput} /></div>
            <div><label className={fieldLabel}>Clinic served</label><input name="clinic_served" defaultValue={event?.clinic_served ?? ""} className={fieldInput} /></div>
            <div><label className={fieldLabel}>Cost</label><input name="cost" defaultValue={event?.cost ?? ""} className={fieldInput} /></div>
          </div>
          <div><label className={fieldLabel}>Description</label><textarea name="description" defaultValue={event?.description ?? ""} rows={2} className={fieldInput} /></div>

          {/* 3rd-party event intake details */}
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">3rd-party event details</legend>
            <p className="mb-3 text-[11px] text-slate-400">Intake captured when a partner invites us — everything ops needs to staff &amp; set up correctly.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className={fieldLabel}>Host company</label><input name="host_company" defaultValue={event?.host_company ?? ""} className={fieldInput} placeholder="Who is hosting?" /></div>
              <div><label className={fieldLabel}>Host website</label><input name="host_website" defaultValue={event?.host_website ?? ""} className={fieldInput} placeholder="https://…" /></div>
              <div><label className={fieldLabel}>Event website / flyer</label><input name="event_url" defaultValue={event?.event_url ?? ""} className={fieldInput} placeholder="Link or flyer info" /></div>
              <div><label className={fieldLabel}>Venue type</label><OptionsSelect name="venue_type" defaultValue={event?.venue_type ?? ""} options={VENUE_TYPES} placeholder="Indoor / outdoor" /></div>
              <div><label className={fieldLabel}>Required arrival time</label><input name="arrival_time" defaultValue={event?.arrival_time ?? ""} className={fieldInput} placeholder="e.g. 8:00 AM (for staffing)" /></div>
              <div><label className={fieldLabel}>Required departure time</label><input name="departure_time" defaultValue={event?.departure_time ?? ""} className={fieldInput} placeholder="e.g. 5:00 PM" /></div>
              <div><label className={fieldLabel}>Audience / foot traffic</label><input name="expected_foot_traffic" defaultValue={event?.expected_foot_traffic ?? ""} className={fieldInput} placeholder="Anticipated attendance" /></div>
              <div><label className={fieldLabel}>Food on-site for staff?</label><input name="food_onsite" defaultValue={event?.food_onsite ?? ""} className={fieldInput} placeholder="e.g. Yes — food trucks" /></div>
            </div>
            <div className="mt-4 grid gap-4">
              <div><label className={fieldLabel}>Expectations / our involvement</label><textarea name="involvement" defaultValue={event?.involvement ?? ""} rows={2} className={fieldInput} placeholder="Physical presence, sponsor, vet services, judges, gift certificates, etc." /></div>
              <div><label className={fieldLabel}>Physical set up</label><textarea name="setup_needs" defaultValue={event?.setup_needs ?? ""} rows={2} className={fieldInput} placeholder="What do we bring vs. what the host provides (tables, chairs, tents)?" /></div>
              <div><label className={fieldLabel}>Parking / loading &amp; unloading</label><textarea name="parking_info" defaultValue={event?.parking_info ?? ""} rows={2} className={fieldInput} placeholder="Where staff parks, load-in/load-out instructions" /></div>
            </div>
          </fieldset>
          </div>

          {/* Planning & promotion */}
          <div className={tab === "planning" ? "space-y-4" : "hidden"}>
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Planning &amp; promotion</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className={fieldLabel}>Supplies</label><input name="supplies" defaultValue={event?.supplies ?? ""} className={fieldInput} placeholder="Tent, table, flyers…" /></div>
              <div><label className={fieldLabel}>Promo channels</label><input name="promo_channels" defaultValue={event?.promo_channels ?? ""} className={fieldInput} placeholder="IG, flyers, email…" /></div>
              <div><label className={fieldLabel}>Source</label><OptionsSelect name="source_id" defaultValue={event?.source_id ?? ""} options={sources.map((s) => ({ value: s.id, label: s.name }))} placeholder="—" /></div>
              <div><label className={fieldLabel}>Landing page URL</label><input name="landing_url" defaultValue={event?.landing_url ?? ""} className={fieldInput} /></div>
              <div><label className={fieldLabel}>RSVP URL</label><input name="rsvp_url" defaultValue={event?.rsvp_url ?? ""} className={fieldInput} /></div>
            </div>
            {/* Checklist */}
            <div className="mt-3">
              <label className={fieldLabel}>Planning checklist</label>
              <div className="space-y-1.5">
                {checklist.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input type="checkbox" checked={c.done} onChange={() => setChecklist(checklist.map((x, i) => i === idx ? { ...x, done: !x.done } : x))} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                    <span className={`flex-1 text-sm ${c.done ? "text-slate-400 line-through" : "text-slate-700"}`}>{c.label}</span>
                    <button type="button" onClick={() => setChecklist(checklist.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-600">✕</button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input value={newCheck} onChange={(e) => setNewCheck(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newCheck.trim()) { setChecklist([...checklist, { label: newCheck.trim(), done: false }]); setNewCheck(""); } } }} placeholder="Add a task…" className={fieldInput} />
                  <button type="button" onClick={() => { if (newCheck.trim()) { setChecklist([...checklist, { label: newCheck.trim(), done: false }]); setNewCheck(""); } }} className={btnGhost}>Add</button>
                </div>
              </div>
            </div>
          </fieldset>

          <StaffPicker
            people={people}
            staffIds={staffIds}
            setStaffIds={setStaffIds}
            startsOn={startsOn}
            endsOn={endsOn}
          />

          <EventPromoFields
            event={event}
            hasPromo={hasPromo}
            setHasPromo={setHasPromo}
            eventStart={startsOn}
            eventEnd={endsOn}
          />
          </div>

          {/* Materials */}
          <div className={tab === "materials" ? "" : "hidden"}>
          <MaterialsEditor
            eventName={event?.name ?? "New event"}
            eventDate={startsOn || null}
            eventLocation={event?.location ?? null}
            items={materials}
            setItems={setMaterials}
          />
          </div>

          {/* QR code & capture form */}
          <div className={tab === "qr" ? "" : "hidden"}>
            <QrPanel
              subject={event ? { kind: "event", id: event.id, name: event.name } : null}
              codes={eventQrCodes}
              forms={qrForms ?? []}
              canEdit={canEdit}
              run={run}
            />
          </div>

          {/* Recap */}
          <fieldset className={`rounded-lg border border-slate-200 p-3 ${tab === "recap" ? "" : "hidden"}`}>
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Recap / results (ROI)</legend>
            <div className="grid gap-4 sm:grid-cols-4">
              <div><label className={fieldLabel}>Attendees</label><input name="attendees" defaultValue={event?.attendees ?? ""} className={fieldInput} /></div>
              <div><label className={fieldLabel}>Sign-ups</label><input name="signups" defaultValue={event?.signups ?? ""} className={fieldInput} /></div>
              <div><label className={fieldLabel}>Appointments</label><input name="appointments" defaultValue={event?.appointments ?? ""} className={fieldInput} /></div>
              <div><label className={fieldLabel}>Coupons redeemed</label><input name="coupons_redeemed" defaultValue={event?.coupons_redeemed ?? ""} className={fieldInput} /></div>
              <div className="sm:col-span-2"><label className={fieldLabel}>Products sold</label><input name="products_sold" defaultValue={event?.products_sold ?? ""} className={fieldInput} /></div>
              <div><label className={fieldLabel}>Redemption codes</label><input name="redemption_codes" defaultValue={event?.redemption_codes ?? ""} className={fieldInput} /></div>
              <div><label className={fieldLabel}>Client spend ($)</label><input name="client_spend" defaultValue={event?.client_spend ?? ""} className={fieldInput} /></div>
            </div>
            <div className="mt-3"><label className={fieldLabel}>Feedback / notes</label><textarea name="feedback" defaultValue={event?.feedback ?? ""} rows={2} className={fieldInput} /></div>
          </fieldset>

          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <div>
              {event && (
                <button type="button" onClick={() => { if (confirm(`Delete "${event.name}"?`)) run(() => deleteEvent(event.id), onClose); }} className="text-sm font-medium text-red-600 hover:text-red-700">Delete event</button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
              <button type="submit" className={btnPrimary}>Save</button>
            </div>
          </div>
        </form>

        {/* Attendees (existing events only) */}
        {event && (
          <AttendeesManager eventId={event.id} attendees={attendees} canEdit={canEdit} run={run} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Packing / Material list — editable, per-event, defaults to the GD master
// template. Each line tracks a status (Need → Decided → Ordered → Received →
// Packed) and the whole list is copy / print / email friendly.
// ---------------------------------------------------------------------------
function fmtPackingDate(d: string | null): string {
  if (!d) return "Date TBD";
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

function packingListToText(
  eventName: string,
  date: string | null,
  location: string | null,
  items: PackingListItem[],
): string {
  const lines: string[] = [];
  lines.push(`GD EVENT — MATERIAL LIST`);
  lines.push(eventName);
  const meta = [fmtPackingDate(date), location].filter(Boolean).join(" · ");
  if (meta) lines.push(meta);
  lines.push(`Status key: [ ] Need  [D] Decided  [O] Ordered  [R] Received  [x] Packed`);
  lines.push("");
  const mark: Record<string, string> = {
    need: "[ ]",
    decided: "[D]",
    ordered: "[O]",
    received: "[R]",
    packed: "[x]",
  };
  for (const it of items) {
    if (!it.label.trim()) continue;
    const qty = it.qty ? `  (${it.qty})` : "";
    const note = it.note ? `  — ${it.note}` : "";
    lines.push(`${mark[it.status] ?? "[ ]"} ${it.label}${qty}${note}`);
  }
  return lines.join("\n").trimEnd();
}

function packingListToHtml(
  eventName: string,
  date: string | null,
  location: string | null,
  items: PackingListItem[],
): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const meta = [fmtPackingDate(date), location].filter(Boolean).map((s) => esc(s as string)).join(" &middot; ");
  const rows = items
    .filter((it) => it.label.trim())
    .map(
      (it) => `
          <tr>
            <td class="chk"><span class="box ${it.status}"></span></td>
            <td class="lbl">${esc(it.label)}${it.note ? `<span class="note"> — ${esc(it.note)}</span>` : ""}</td>
            <td class="qty">${it.qty ? esc(it.qty) : ""}</td>
            <td class="st">${esc(it.status)}</td>
          </tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(eventName)} — Material List</title>
    <style>
      * { box-sizing: border-box; }
      body { font: 13px/1.4 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 24px; }
      h1 { font-size: 18px; margin: 0 0 2px; }
      .meta { color: #475569; font-size: 12px; margin-bottom: 4px; }
      .key { color: #475569; font-size: 11px; margin-bottom: 14px; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      tr.grp td { background: #f1f5f9; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; color: #334155; border-bottom: 1px solid #cbd5e1; padding-top: 10px; }
      .chk { width: 22px; }
      .box { display: inline-block; width: 13px; height: 13px; border: 1.5px solid #94a3b8; border-radius: 3px; }
      .box.decided { border-color: #d97706; background: #fef3c7; }
      .box.ordered { border-color: #0284c7; background: #e0f2fe; }
      .box.received { border-color: #7c3aed; background: #ede9fe; }
      .box.packed { border-color: #059669; background: #059669; }
      .qty { width: 90px; color: #475569; white-space: nowrap; }
      .st { width: 70px; text-transform: capitalize; color: #64748b; font-size: 11px; }
      .note { color: #64748b; }
      @media print { body { margin: 0; } .st { display: none; } }
    </style></head><body>
    <h1>${esc(eventName)} — Material List</h1>
    ${meta ? `<div class="meta">${meta}</div>` : ""}
    <div class="key">Need &bull; Decided &bull; Ordered &bull; Received &bull; Packed</div>
    <table><tbody>${rows}</tbody></table>
    </body></html>`;
}

// ---------------------------------------------------------------------------
// Materials — one flat, hand-built list. Items are added one at a time; there
// is deliberately no master template to prune.
// ---------------------------------------------------------------------------
function MaterialsEditor({
  eventName,
  eventDate,
  eventLocation,
  items,
  setItems,
}: {
  eventName: string;
  eventDate: string | null;
  eventLocation: string | null;
  items: PackingListItem[];
  setItems: React.Dispatch<React.SetStateAction<PackingListItem[]>>;
}) {
  const [copied, setCopied] = useState(false);

  const packed = useMemo(
    () => items.filter((it) => it.status === "packed").length,
    [items],
  );

  const mutateItem = (idx: number, patch: Partial<PackingListItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));
  const addItem = () =>
    setItems((prev) => [...prev, { label: "", qty: null, status: "need", note: null }]);

  async function copyList() {
    const text = packingListToText(eventName, eventDate, eventLocation, items);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy the material list:", text);
    }
  }

  function printList() {
    const html = packingListToHtml(eventName, eventDate, eventLocation, items);
    const w = window.open("", "_blank", "width=760,height=900");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }

  function emailList() {
    const subject = `Material list — ${eventName}`;
    const body = packingListToText(eventName, eventDate, eventLocation, items);
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Material list</legend>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">
          Add what this event needs, one item at a time. {packed}/{items.length} packed.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={copyList} className={btnGhost}>{copied ? "✓ Copied" : "📋 Copy"}</button>
          <button type="button" onClick={printList} className={btnGhost}>🖨️ Print</button>
          <button type="button" onClick={emailList} className={btnGhost}>✉️ Email</button>
        </div>
      </div>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/40">
        {items.map((it, idx) => (
          <li key={idx} className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
            <div className="flex overflow-hidden rounded-md border border-slate-200">
              {PACKING_STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => mutateItem(idx, { status: s.value })}
                  title={s.label}
                  className={`px-1.5 py-1 text-[10px] font-semibold transition ${it.status === s.value ? PACKING_STATUS_STYLES[s.value] : "bg-white text-slate-400 hover:bg-slate-50"}`}
                >
                  {s.label[0]}
                </button>
              ))}
            </div>
            <input
              value={it.label}
              onChange={(e) => mutateItem(idx, { label: e.target.value })}
              placeholder="Item…"
              className="min-w-[8rem] flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none"
            />
            <input
              value={it.qty ?? ""}
              onChange={(e) => mutateItem(idx, { qty: e.target.value || null })}
              placeholder="Qty"
              className="w-20 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
            <input
              value={it.note ?? ""}
              onChange={(e) => mutateItem(idx, { note: e.target.value || null })}
              placeholder="Note"
              className="w-32 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 focus:border-emerald-400 focus:outline-none"
            />
            <button type="button" onClick={() => removeItem(idx)} className="px-1 text-slate-300 hover:text-red-600">✕</button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-2 py-4 text-center text-[11px] text-slate-400">Nothing on the list yet.</li>
        )}
      </ul>
      <button type="button" onClick={addItem} className={`${btnGhost} mt-3`}>＋ Add item</button>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Staff — picked from the HR roster, with a live read of the Schedule grid so
// the event manager can see who is already committed to a shift that day.
// ---------------------------------------------------------------------------
function fmtShiftDay(d: string): string {
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtShiftTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hour = Number(h);
  if (!Number.isFinite(hour)) return t;
  const ampm = hour >= 12 ? "p" : "a";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return m && m !== "00" ? `${h12}:${m}${ampm}` : `${h12}${ampm}`;
}

function StaffPicker({
  people,
  staffIds,
  setStaffIds,
  startsOn,
  endsOn,
}: {
  people: PersonOption[];
  staffIds: string[];
  setStaffIds: React.Dispatch<React.SetStateAction<string[]>>;
  startsOn: string;
  endsOn: string;
}) {
  const [pick, setPick] = useState("");
  // Cached with the key it was fetched for, so a stale result is never shown
  // and the effect never has to synchronously reset state.
  const [result, setResult] = useState<{ key: string; shifts: EventStaffShift[] }>({
    key: "",
    shifts: [],
  });

  // One primitive key so the lookup re-runs on any real change, not on every
  // new array identity.
  const lookupKey = `${startsOn}|${endsOn}|${[...staffIds].sort().join(",")}`;

  useEffect(() => {
    const [start, end, ids] = lookupKey.split("|");
    const personIds = ids ? ids.split(",") : [];
    if (!start || personIds.length === 0) return;
    let cancelled = false;
    lookupEventStaffShifts(start, end || null, personIds).then((res) => {
      if (!cancelled) setResult({ key: lookupKey, shifts: res.ok ? res.shifts : [] });
    });
    return () => {
      cancelled = true;
    };
  }, [lookupKey]);

  const fresh = result.key === lookupKey;
  const checking = !fresh && Boolean(startsOn) && staffIds.length > 0;

  const shiftsByPerson = useMemo(() => {
    const m = new Map<string, EventStaffShift[]>();
    if (!fresh) return m;
    for (const s of result.shifts) {
      const list = m.get(s.person_id) ?? [];
      list.push(s);
      m.set(s.person_id, list);
    }
    return m;
  }, [fresh, result.shifts]);

  const available = people.filter((p) => !staffIds.includes(p.id));

  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Staff</legend>
      <p className="mb-3 text-[11px] text-slate-400">
        Pick from the employee roster. Anyone already on the published schedule that
        day is flagged so you don&apos;t double-book them.
      </p>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
        {staffIds.map((id) => {
          const person = people.find((p) => p.id === id);
          const booked = shiftsByPerson.get(id) ?? [];
          return (
            <li key={id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="flex-1 text-sm font-medium text-slate-700">
                {person ? personLabel(person) : "Unknown person"}
              </span>
              {!startsOn ? (
                <span className="text-[11px] text-slate-400">Set a date to check the schedule</span>
              ) : checking ? (
                <span className="text-[11px] text-slate-400">Checking schedule…</span>
              ) : booked.length > 0 ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  ⚠ Scheduled{" "}
                  {booked
                    .slice(0, 2)
                    .map((s) => {
                      const time = [fmtShiftTime(s.start_time), fmtShiftTime(s.end_time)]
                        .filter(Boolean)
                        .join("–");
                      return `${fmtShiftDay(s.work_date)} ${s.location_name}${time ? ` ${time}` : ""}`;
                    })
                    .join(" · ")}
                  {booked.length > 2 && ` +${booked.length - 2}`}
                </span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  Not scheduled
                </span>
              )}
              <button
                type="button"
                onClick={() => setStaffIds((prev) => prev.filter((x) => x !== id))}
                className="px-1 text-slate-300 hover:text-red-600"
                aria-label="Remove"
              >
                ✕
              </button>
            </li>
          );
        })}
        {staffIds.length === 0 && (
          <li className="px-3 py-3 text-center text-[11px] text-slate-400">No staff assigned yet.</li>
        )}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${fieldInput} max-w-xs`}>
          <option value="">Choose an employee…</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {personLabel(p)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!pick}
          onClick={() => {
            if (!pick) return;
            setStaffIds((prev) => (prev.includes(pick) ? prev : [...prev, pick]));
            setPick("");
          }}
          className={btnGhost}
        >
          ＋ Add staff
        </button>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Event promotion — the Yes/No that drives the list view's Promo column and
// mirrors a row into Marketing Mgmt → Promotions on save.
// ---------------------------------------------------------------------------
function EventPromoFields({
  event,
  hasPromo,
  setHasPromo,
  eventStart,
  eventEnd,
}: {
  event: MarketingEvent | null;
  hasPromo: boolean;
  setHasPromo: (v: boolean) => void;
  eventStart: string;
  eventEnd: string;
}) {
  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Event promotion</legend>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="has_promo"
          checked={hasPromo}
          onChange={(e) => setHasPromo(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
        />
        <span className="text-sm font-medium text-slate-700">
          This event has its own promotion
        </span>
      </label>

      {hasPromo && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label className={fieldLabel}>Promotion name</label>
              <input
                name="promo_name"
                defaultValue={event?.promo_name ?? ""}
                placeholder={event?.name ? `${event.name} promo` : "e.g. $50 off a dental"}
                className={fieldInput}
              />
            </div>
            <div>
              <label className={fieldLabel}>Active start</label>
              <input type="date" name="promo_starts_on" defaultValue={event?.promo_starts_on ?? eventStart} className={fieldInput} />
            </div>
            <div>
              <label className={fieldLabel}>Active end</label>
              <input type="date" name="promo_ends_on" defaultValue={event?.promo_ends_on ?? eventEnd} className={fieldInput} />
            </div>
          </div>
          <div>
            <label className={fieldLabel}>Promotion details</label>
            <textarea
              name="promo_details"
              defaultValue={event?.promo_details ?? ""}
              rows={3}
              placeholder="What's the offer, who can redeem it, and how?"
              className={fieldInput}
            />
          </div>
          <p className="text-[11px] text-slate-400">
            Saving adds this to Marketing Mgmt → Promotions and keeps it in sync.
            Unchecking the box removes it from that list again.
          </p>
        </div>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// QR code panel — a printable code per event or CE course plus the custom
// capture form behind it. Everything here posts through explicit FormData
// because this panel can live inside the event form (no nested <form>, no
// stray `name` attributes).
// ---------------------------------------------------------------------------
export function QrPanel({
  subject,
  codes,
  forms,
  canEdit,
  run,
}: {
  subject: { kind: "event" | "ce"; id: string; name: string } | null;
  codes: QrCode[];
  forms: QrForm[];
  canEdit: boolean;
  run: Run;
}) {
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    // Browser-only value, read after mount to avoid a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  if (!subject) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
        Save the event first — then you can generate its QR code and sign-up form here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {codes.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
          <p className="text-sm text-slate-600">
            No QR code yet. Generate one and we&apos;ll create a starter sign-up form
            with it — every scan lands in Event Leads.
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => run(() => createQrCodeFor(subject.kind, subject.id, subject.name))}
              className={`${btnPrimary} mt-3`}
            >
              Create QR code &amp; form
            </button>
          )}
        </div>
      )}

      {codes.map((code) => (
        <EventQrCard
          key={code.id}
          code={code}
          forms={forms}
          origin={origin}
          canEdit={canEdit}
          run={run}
        />
      ))}

      {codes.length > 0 && canEdit && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => run(() => createQrCodeFor(subject.kind, subject.id, subject.name))}
            className={btnGhost}
          >
            ＋ Add another code
          </button>
          <Link href="/marketing?tab=qr_codes" className="text-xs font-medium text-emerald-700 hover:underline">
            Manage all QR codes →
          </Link>
        </div>
      )}
    </div>
  );
}

function EventQrCard({
  code,
  forms,
  origin,
  canEdit,
  run,
}: {
  code: QrCode;
  forms: QrForm[];
  origin: string;
  canEdit: boolean;
  run: Run;
}) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const url = origin ? qrScanUrl(origin, code.token) : "";
  const linkedForm = forms.find((f) => f.id === code.form_id) ?? null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy the link:", url);
    }
  }

  function download() {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const slug = code.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "qr";
    const link = document.createElement("a");
    link.download = `${slug}-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div ref={qrRef} className="mx-auto shrink-0 rounded-lg border border-slate-200 p-2 sm:mx-0">
          {url ? <QRCodeCanvas value={url} size={150} marginSize={2} level="M" /> : <div className="h-[150px] w-[150px]" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-800">{code.label}</p>
            <Badge className={code.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}>
              {code.active ? "Active" : "Inactive"}
            </Badge>
            <span className="text-[11px] text-slate-400">{code.scan_count} scans</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            />
            <button type="button" onClick={copy} className={btnGhost}>{copied ? "✓ Copied" : "Copy link"}</button>
            <button type="button" onClick={download} className={btnGhost}>Download QR</button>
          </div>
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => run(() => setQrCodeActive(code.id, !code.active))}
                className="font-medium text-slate-500 hover:text-slate-800"
              >
                {code.active ? "Deactivate" : "Activate"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete the QR code "${code.label}"? Printed copies stop working.`)) {
                    run(() => deleteQrCode(code.id));
                  }
                }}
                className="font-medium text-red-600 hover:text-red-700"
              >
                Delete code
              </button>
            </div>
          )}
        </div>
      </div>

      <QrFormEditor
        key={code.form_id ?? "none"}
        code={code}
        form={linkedForm}
        forms={forms}
        canEdit={canEdit}
        run={run}
      />
    </div>
  );
}

type FormDraft = {
  name: string;
  headline: string;
  intro: string;
  success_message: string;
  collect_pet_name: boolean;
  collect_zip: boolean;
  fields: QrFormField[];
};

function QrFormEditor({
  code,
  form,
  forms,
  canEdit,
  run,
}: {
  code: QrCode;
  form: QrForm | null;
  forms: QrForm[];
  canEdit: boolean;
  run: Run;
}) {
  const [draft, setDraft] = useState<FormDraft>(() => ({
    name: form?.name ?? code.label,
    headline: form?.headline ?? "",
    intro: form?.intro ?? "",
    success_message: form?.success_message ?? "",
    collect_pet_name: form?.collect_pet_name ?? true,
    collect_zip: form?.collect_zip ?? false,
    fields: form?.fields ?? [],
  }));

  function patch(p: Partial<FormDraft>) {
    setDraft((prev) => ({ ...prev, ...p }));
  }
  function patchField(idx: number, p: Partial<QrFormField>) {
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.map((f, i) => (i === idx ? { ...f, ...p } : f)),
    }));
  }

  function save() {
    const fd = new FormData();
    if (form) fd.set("id", form.id);
    fd.set("name", draft.name);
    fd.set("headline", draft.headline);
    fd.set("intro", draft.intro);
    fd.set("success_message", draft.success_message);
    if (draft.collect_pet_name) fd.set("collect_pet_name", "true");
    if (draft.collect_zip) fd.set("collect_zip", "true");
    fd.set("active", "true");
    fd.set(
      "fields_json",
      JSON.stringify(
        draft.fields
          .filter((f) => f.label.trim())
          .map((f) => ({ ...f, key: f.key || slugifyFieldKey(f.label) })),
      ),
    );
    run(() => saveQrForm(fd));
  }

  function linkForm(formId: string) {
    const fd = new FormData();
    fd.set("id", code.id);
    fd.set("label", code.label);
    fd.set("code_type", code.code_type);
    if (code.event_id) fd.set("event_id", code.event_id);
    if (code.target_url) fd.set("target_url", code.target_url);
    fd.set("form_id", formId);
    fd.set("active", String(code.active));
    run(() => saveQrCode(fd));
  }

  if (!form) {
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
        <p className="text-sm text-amber-800">This code has no form attached — a scan will 404.</p>
        {canEdit && forms.length > 0 && (
          <select
            defaultValue=""
            onChange={(e) => e.target.value && linkForm(e.target.value)}
            className={`${fieldInput} mt-2 max-w-xs`}
          >
            <option value="">Attach an existing form…</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Capture form</p>
        {canEdit && (
          <button type="button" onClick={save} className={btnPrimary}>Save form</button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={fieldLabel}>Form name (internal)</label>
          <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} className={fieldInput} />
        </div>
        <div>
          <label className={fieldLabel}>Headline (shown on the page)</label>
          <input value={draft.headline} onChange={(e) => patch({ headline: e.target.value })} className={fieldInput} />
        </div>
        <div className="sm:col-span-2">
          <label className={fieldLabel}>Intro text</label>
          <textarea value={draft.intro} onChange={(e) => patch({ intro: e.target.value })} rows={2} className={fieldInput} />
        </div>
        <div className="sm:col-span-2">
          <label className={fieldLabel}>Thank-you message</label>
          <input value={draft.success_message} onChange={(e) => patch({ success_message: e.target.value })} className={fieldInput} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={draft.collect_pet_name} onChange={(e) => patch({ collect_pet_name: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
          Ask for pet name
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={draft.collect_zip} onChange={(e) => patch({ collect_zip: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
          Ask for ZIP code
        </label>
        <span className="text-xs text-slate-400">Name + email/phone are always collected.</span>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Custom questions</p>
        <ul className="space-y-2">
          {draft.fields.map((f, idx) => (
            <li key={idx} className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={f.label}
                  onChange={(e) => patchField(idx, { label: e.target.value })}
                  placeholder="Question…"
                  className="min-w-[10rem] flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-emerald-400 focus:outline-none"
                />
                <select
                  value={f.type}
                  onChange={(e) => patchField(idx, { type: e.target.value as QrFormField["type"] })}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                >
                  {QR_FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[11px] text-slate-500">
                  <input type="checkbox" checked={f.required} onChange={(e) => patchField(idx, { required: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600" />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, fields: prev.fields.filter((_, i) => i !== idx) }))}
                  className="px-1 text-slate-300 hover:text-red-600"
                >
                  ✕
                </button>
              </div>
              {f.type === "select" && (
                <input
                  value={f.options.join(", ")}
                  onChange={(e) => patchField(idx, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  placeholder="Options, comma separated"
                  className="mt-1.5 w-full rounded-md border border-slate-200 px-2 py-1 text-xs focus:border-emerald-400 focus:outline-none"
                />
              )}
            </li>
          ))}
          {draft.fields.length === 0 && (
            <li className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-[11px] text-slate-400">
              No extra questions — the form just collects contact details.
            </li>
          )}
        </ul>
        {canEdit && (
          <button
            type="button"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                fields: [...prev.fields, { key: "", label: "", type: "text", required: false, options: [], placeholder: null }],
              }))
            }
            className={`${btnGhost} mt-2`}
          >
            ＋ Add question
          </button>
        )}
      </div>
    </div>
  );
}


function AttendeesManager({ eventId, attendees, canEdit, run }: { eventId: string; attendees: MarketingEventAttendee[]; canEdit: boolean; run: Run }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState("lead");

  function add() {
    if (!name.trim() && !email.trim() && !phone.trim()) return;
    const fd = new FormData();
    fd.set("event_id", eventId);
    fd.set("name", name);
    fd.set("email", email);
    fd.set("phone", phone);
    fd.set("attendee_type", type);
    if (type === "new_client") fd.set("is_new_client", "true");
    run(() => saveAttendee(fd), () => { setName(""); setEmail(""); setPhone(""); });
  }

  return (
    <div className="border-t border-slate-200 px-5 py-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Attendees / sign-ups ({attendees.length})</p>
      {attendees.length > 0 && (
        <ul className="mb-3 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
          {attendees.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1 text-slate-700">{a.name || a.email || a.phone || "—"}</span>
              <span className="text-xs text-slate-400">{[a.email, a.phone].filter(Boolean).join(" · ")}</span>
              <Badge className="bg-slate-100 text-slate-600">{attendeeTypeLabel(a.attendee_type)}</Badge>
              {canEdit && <button type="button" onClick={() => run(() => deleteAttendee(a.id))} className="text-slate-400 hover:text-red-600">✕</button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="grid gap-2 sm:grid-cols-[1.2fr_1.5fr_1fr_1fr_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={fieldInput} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className={fieldInput} />
          <PhoneInput value={phone} onValueChange={setPhone} placeholder="Phone" className={fieldInput} />
          <select value={type} onChange={(e) => setType(e.target.value)} className={fieldInput}>
            {ATTENDEE_TYPES.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
          <button type="button" onClick={add} className={btnPrimary}>Add</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function SourceDialog({ source, crmOrgs, canEdit, onClose, run }: { source: MarketingEventSource | null; crmOrgs: CrmOrgRef[]; canEdit: boolean; onClose: () => void; run: Run }) {
  const [linkTarget, setLinkTarget] = useState("");
  const linkedOrg = source?.crm_organization_id
    ? crmOrgs.find((o) => o.id === source.crm_organization_id)
    : undefined;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveEventSource(fd), onClose);
  }
  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">{source ? "Edit source" : "New event source"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">✕</button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 px-5 py-4">
          {source && <input type="hidden" name="id" value={source.id} />}
          <div><label className={fieldLabel}>Name</label><input name="name" defaultValue={source?.name ?? ""} required className={fieldInput} /></div>
          <div><label className={fieldLabel}>URL</label><input name="url" defaultValue={source?.url ?? ""} placeholder="https://…" className={fieldInput} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className={fieldLabel}>Region</label><input name="region" defaultValue={source?.region ?? ""} className={fieldInput} /></div>
            <div><label className={fieldLabel}>Membership / cost</label><input name="membership_cost" defaultValue={source?.membership_cost ?? ""} className={fieldInput} /></div>
          </div>
          <div><label className={fieldLabel}>Notes</label><textarea name="notes" defaultValue={source?.notes ?? ""} rows={2} className={fieldInput} /></div>

          {/* Vendor & Partner CRM link */}
          {source && (
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor &amp; Partner CRM</legend>
              {source.crm_organization_id ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-slate-600">
                    Linked to{" "}
                    <Link href={`/crm/org/${source.crm_organization_id}`} className="font-medium text-emerald-700 hover:underline">
                      {linkedOrg?.name ?? "CRM record"} ↗
                    </Link>
                    <p className="text-xs text-slate-400">Edit all fields on the CRM record.</p>
                  </div>
                  {canEdit && (
                    <button type="button" onClick={() => run(() => linkSourceToCrm(source.id, ""), onClose)} className="text-xs font-medium text-red-600 hover:text-red-700">Unlink</button>
                  )}
                </div>
              ) : canEdit ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">This source isn&apos;t in the Vendor &amp; Partner CRM yet.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)} className={fieldInput + " max-w-[16rem]"}>
                      <option value="">Link to an existing record…</option>
                      {crmOrgs.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
                    </select>
                    <button type="button" disabled={!linkTarget} onClick={() => run(() => linkSourceToCrm(source.id, linkTarget), onClose)} className={btnGhost}>Link</button>
                    <span className="text-xs text-slate-400">or</span>
                    <button type="button" onClick={() => run(() => syncSourceToCrm(source.id), onClose)} className={btnPrimary}>Create CRM record</button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Not linked to the CRM.</p>
              )}
            </fieldset>
          )}

          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <div>
              {source && <button type="button" onClick={() => { if (confirm(`Delete "${source.name}"?`)) run(() => deleteEventSource(source.id), onClose); }} className="text-sm font-medium text-red-600 hover:text-red-700">Delete</button>}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
              <button type="submit" className={btnPrimary}>Save</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
