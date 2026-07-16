"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  type MarketingEvent,
  type MarketingEventSource,
  type MarketingEventAttendee,
  type ChecklistItem,
  type CrmOrgRef,
  EVENT_TYPES,
  EVENT_STATUSES,
  PLANNING_PHASES,
  ATTENDEE_TYPES,
  VENUE_TYPES,
  eventTypeLabel,
  eventStatusLabel,
  planningPhaseLabel,
  attendeeTypeLabel,
} from "@/lib/marketing/types";
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
  type ActionResult,
} from "./actions";

const fieldInput =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const fieldLabel = "mb-1 block text-xs font-medium text-slate-500";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50";
const btnGhost =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50";

const STATUS_COLORS: Record<string, string> = {
  researching: "bg-slate-100 text-slate-600",
  tentative: "bg-sky-50 text-sky-700",
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

type Run = (action: () => Promise<ActionResult>, after?: () => void) => void;

// ===========================================================================
export function EventsTab({
  canEdit,
  events,
  sources,
  attendees,
  crmOrgs,
}: {
  canEdit: boolean;
  events: MarketingEvent[];
  sources: MarketingEventSource[];
  attendees: MarketingEventAttendee[];
  crmOrgs: CrmOrgRef[];
}) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<MarketingEvent | "new" | null>(null);
  const [editingSource, setEditingSource] = useState<MarketingEventSource | "new" | null>(null);
  const [showSources, setShowSources] = useState(true);
  const [view, setView] = useState<"all" | "upcoming" | "past">("all");

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
    const up: MarketingEvent[] = [];
    const pa: MarketingEvent[] = [];
    for (const e of events) {
      const isPast = e.status === "completed" || e.status === "cancelled" || (e.starts_on != null && e.starts_on < today);
      (isPast ? pa : up).push(e);
    }
    pa.sort((a, b) => (b.starts_on ?? "").localeCompare(a.starts_on ?? ""));
    return { upcoming: up, past: pa };
  }, [events, today]);

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

  return (
    <section className="space-y-5">
      {/* Event sources */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <button type="button" onClick={() => setShowSources((v) => !v)} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span aria-hidden className={`transition-transform ${showSources ? "" : "-rotate-90"}`}>⌄</span>
            🔎 Event sources to scout ({sources.length})
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
          <div className="overflow-x-auto border-t border-slate-100">
            {sources.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">No sources yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Source</th>
                    <th className="px-4 py-2 font-semibold">Region</th>
                    <th className="px-4 py-2 font-semibold">Cost</th>
                    <th className="px-4 py-2 font-semibold">CRM</th>
                    <th className="px-4 py-2 font-semibold">Last checked</th>
                    <th className="px-4 py-2 font-semibold">Notes</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sources.map((s) => {
                    const d = daysAgo(s.last_checked_on);
                    const stale = d == null || d > 31;
                    return (
                      <tr key={s.id} className="align-top">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900">
                            {s.url ? (
                              <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-700">{s.name} ↗</a>
                            ) : s.name}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{s.region ?? "—"}</td>
                        <td className="px-4 py-2.5 text-slate-600">{s.membership_cost ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          {s.crm_organization_id ? (
                            <Link
                              href={`/crm/org/${s.crm_organization_id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                              title={orgById.get(s.crm_organization_id)?.name ?? "Open CRM record"}
                            >
                              🤝 CRM ↗
                            </Link>
                          ) : canEdit ? (
                            <button
                              type="button"
                              onClick={() => run(() => syncSourceToCrm(s.id))}
                              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                              title="Create or link a Vendor & Partner CRM record"
                            >
                              + Link CRM
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
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
        const rows = view === "upcoming" ? upcoming : view === "past" ? past : [...upcoming, ...past];
        if (rows.length === 0) return <Empty label="No events." />;
        return (
          <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm" style={{ maxHeight: "70vh" }}>
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-20 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="sticky left-0 z-30 bg-slate-50 px-4 py-2.5 font-semibold">Event</th>
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 font-semibold">Type</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Planning</th>
                  <th className="px-4 py-2.5 font-semibold">Owner</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Cost</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Attendees</th>
                  <th className="px-4 py-2.5 font-semibold">Checklist</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((e) => {
                  const att = (attendeesByEvent.get(e.id) ?? []).length;
                  const cd = e.checklist?.filter((c) => c.done).length ?? 0;
                  const ct = e.checklist?.length ?? 0;
                  return (
                    <tr
                      key={e.id}
                      className="group cursor-pointer transition hover:bg-emerald-50/40"
                      onClick={() => canEdit && setEditing(e)}
                    >
                      <td className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium text-slate-900 group-hover:bg-emerald-50/40">
                        {e.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fmtDate(e.starts_on)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5"><Badge>{eventTypeLabel(e.event_type)}</Badge></td>
                      <td className="whitespace-nowrap px-4 py-2.5"><Badge className={STATUS_COLORS[e.status]}>{eventStatusLabel(e.status)}</Badge></td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{e.planning_phase ? planningPhaseLabel(e.planning_phase) : "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{e.owner_name ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-600">{e.cost != null ? fmtMoney(e.cost) : "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-600">{fmtNum(e.attendees ?? (att || null))}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{ct > 0 ? `${cd}/${ct}` : "—"}</td>
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
          onClose={() => setEditing(null)}
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
function EventDialog({ event, sources, attendees, canEdit, onClose, run }: {
  event: MarketingEvent | null;
  sources: MarketingEventSource[];
  attendees: MarketingEventAttendee[];
  canEdit: boolean;
  onClose: () => void;
  run: Run;
}) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>(event?.checklist ?? []);
  const [newCheck, setNewCheck] = useState("");

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
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">✕</button>
        </div>

        <form onSubmit={onSubmit} className="max-h-[72vh] space-y-5 overflow-y-auto px-5 py-4">
          {event && <input type="hidden" name="id" value={event.id} />}
          {/* hidden checklist mirrors */}
          {checklist.map((c, i) => (
            <span key={`h-${i}`}>
              <input type="hidden" name="check_label" value={c.label} />
              <input type="hidden" name="check_done" value={String(c.done)} />
            </span>
          ))}

          {/* Details */}
          <div>
            <label className={fieldLabel}>Event name</label>
            <input name="name" defaultValue={event?.name ?? ""} required className={fieldInput} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className={fieldLabel}>Type</label><OptionsSelect name="event_type" defaultValue={event?.event_type ?? "third_party"} options={EVENT_TYPES} /></div>
            <div><label className={fieldLabel}>Status</label><OptionsSelect name="status" defaultValue={event?.status ?? "researching"} options={EVENT_STATUSES} /></div>
            <div><label className={fieldLabel}>Planning phase</label><OptionsSelect name="planning_phase" defaultValue={event?.planning_phase ?? ""} options={PLANNING_PHASES} placeholder="—" /></div>
            <div><label className={fieldLabel}>Start date</label><input type="date" name="starts_on" defaultValue={event?.starts_on ?? ""} className={fieldInput} /></div>
            <div><label className={fieldLabel}>End date</label><input type="date" name="ends_on" defaultValue={event?.ends_on ?? ""} className={fieldInput} /></div>
            <div><label className={fieldLabel}>Owner</label><input name="owner_name" defaultValue={event?.owner_name ?? ""} className={fieldInput} /></div>
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

          {/* Planning & promotion */}
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Planning & promotion</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className={fieldLabel}>Staff</label><input name="staff" defaultValue={event?.staff ?? ""} className={fieldInput} placeholder="Who's working it" /></div>
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

          {/* Recap */}
          <fieldset className="rounded-lg border border-slate-200 p-3">
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
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className={fieldInput} />
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
