"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { QRCodeCanvas } from "qrcode.react";
import type { CrmContact, CrmCeAttendance, CrmCeEvent } from "@/lib/crm/types";
import {
  CE_AUDIENCE_OPTIONS,
  CE_COST_TYPE_OPTIONS,
  CE_STATUS_OPTIONS,
  CE_APPROVAL_STATUS_OPTIONS,
  CE_COURSE_TYPE_OPTIONS,
  CE_DELIVERY_METHOD_OPTIONS,
  CE_PLANNING_CHECKLIST,
} from "@/lib/crm/types";
import { ContactListView } from "../crm-views";
import {
  setCeAttendanceField,
  deleteCeEvent,
  assignLeadToCeEvent,
  setCeEventChecklistItem,
} from "../actions";
import { CeEventForm } from "./ce-event-form";

type AttendeeRow = CrmCeAttendance & { attendeeName: string; contactId: string };

type EventEntry = {
  key: string;
  name: string;
  event: CrmCeEvent | null;
  rows: AttendeeRow[];
};

function labelFor(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string | null,
): string | null {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label ?? value;
}

type ToggleField =
  | "paid"
  | "showed_up"
  | "materials_prepared"
  | "confirmed_date";

type SortKey =
  | "attendeeName"
  | "ce_date"
  | "confirmed_date"
  | "paid"
  | "showed_up"
  | "materials_prepared";

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const parsed = new Date(`${d}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? d
    : parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function contactName(c: CrmContact): string {
  if (c.full_name) return c.full_name;
  const parts = [c.first_name, c.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "Unnamed";
}

function Check({ on }: { on: boolean }) {
  return on ? (
    <span className="font-semibold text-emerald-600">✓</span>
  ) : (
    <span className="text-slate-300">—</span>
  );
}

/** Interactive check-in toggle for a boolean field. */
function ToggleCell({
  on,
  busy,
  canEdit,
  onToggle,
}: {
  on: boolean;
  busy: boolean;
  canEdit: boolean;
  onToggle: () => void;
}) {
  if (!canEdit) return <Check on={on} />;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={on}
      className={`mx-auto flex h-6 w-6 items-center justify-center rounded-md border text-sm transition disabled:opacity-50 print:hidden ${
        on
          ? "border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600"
          : "border-slate-300 bg-white text-transparent hover:border-emerald-400 hover:bg-emerald-50"
      }`}
    >
      ✓
    </button>
  );
}

/** Clickable, sortable column header. */
function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  center,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  center?: boolean;
}) {
  const isActive = activeKey === sortKey;
  return (
    <th
      className={`px-3 py-2.5 font-semibold ${center ? "text-center" : ""}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ${
          isActive ? "text-slate-700" : "text-slate-500"
        } ${center ? "mx-auto" : ""}`}
      >
        {label}
        <span className="text-[10px] leading-none">
          {isActive ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}


function CeAttendeesView({
  contacts,
  attendance,
  events: eventEntities,
  canEdit,
}: {
  contacts: CrmContact[];
  attendance: CrmCeAttendance[];
  events: CrmCeEvent[];
  canEdit: boolean;
}) {
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts) m.set(c.id, contactName(c));
    return m;
  }, [contacts]);

  // Local copy of attendance so check-in toggles update the grid instantly.
  // Re-sync whenever the server sends fresh data (after revalidation).
  const [rows, setRows] = useState<CrmCeAttendance[]>(attendance);
  useEffect(() => setRows(attendance), [attendance]);

  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  function toggle(row: CrmCeAttendance, field: ToggleField) {
    const key = `${row.id}:${field}`;
    const currentlyOn =
      field === "confirmed_date" ? !!row.confirmed_date : !!row[field];
    const next = !currentlyOn;
    // Optimistic update.
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? field === "confirmed_date"
            ? {
                ...r,
                confirmed_date: next ? new Date().toISOString().slice(0, 10) : null,
              }
            : { ...r, [field]: next }
          : r,
      ),
    );
    setPending((p) => ({ ...p, [key]: true }));
    startTransition(async () => {
      const res = await setCeAttendanceField(row.id, field, next);
      setPending((p) => {
        const { [key]: _omit, ...rest } = p;
        return rest;
      });
      if (!res.ok) {
        // Revert on failure.
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? field === "confirmed_date"
                ? { ...r, confirmed_date: row.confirmed_date }
                : { ...r, [field]: currentlyOn }
              : r,
          ),
        );
        alert(`Could not update: ${res.error}`);
      }
    });
  }

  // Build the event list: every CE event entity (so it shows even with zero
  // attendees), each with its rostered attendees, plus any legacy name-only
  // groups (attendance rows not linked to an entity) that don't match one.
  const events = useMemo<EventEntry[]>(() => {
    const toRow = (a: CrmCeAttendance): AttendeeRow => ({
      ...a,
      contactId: a.contact_id,
      attendeeName: nameById.get(a.contact_id) ?? "Unknown",
    });
    const byName = new Map<string, CrmCeEvent>();
    for (const ev of eventEntities) byName.set(ev.name, ev);

    const byEventId = new Map<string, AttendeeRow[]>();
    const leftover = new Map<string, AttendeeRow[]>();
    for (const a of rows) {
      const matchId =
        a.ce_event_id && eventEntities.some((e) => e.id === a.ce_event_id)
          ? a.ce_event_id
          : !a.ce_event_id && byName.has(a.ce_name)
            ? byName.get(a.ce_name)!.id
            : null;
      if (matchId) {
        const list = byEventId.get(matchId) ?? [];
        list.push(toRow(a));
        byEventId.set(matchId, list);
      } else {
        const key = a.ce_name || "Untitled CE";
        const list = leftover.get(key) ?? [];
        list.push(toRow(a));
        leftover.set(key, list);
      }
    }

    const sortRows = (list: AttendeeRow[]) =>
      list.sort((a, b) => a.attendeeName.localeCompare(b.attendeeName));

    const entityEntries: EventEntry[] = eventEntities.map((ev) => ({
      key: ev.id,
      name: ev.name,
      event: ev,
      rows: sortRows(byEventId.get(ev.id) ?? []),
    }));

    const legacyEntries: EventEntry[] = Array.from(leftover.entries()).map(
      ([name, list]) => ({
        key: `legacy:${name}`,
        name,
        event: null,
        rows: sortRows(list),
      }),
    );

    return [...entityEntries, ...legacyEntries].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [rows, nameById, eventEntities]);


  const [selected, setSelected] = useState<string | null>(
    events[0]?.key ?? null,
  );
  const active = events.find((e) => e.key === selected) ?? events[0] ?? null;

  const [showShare, setShowShare] = useState(false);
  // "All" = everyone we reached out to; "Confirmed" = only attendees whose
  // date has been confirmed (i.e. expected to show up).
  const [confirmedOnly, setConfirmedOnly] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("attendeeName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedRows = useMemo(() => {
    if (!active) return [];
    const base = confirmedOnly
      ? active.rows.filter((r) => !!r.confirmed_date)
      : active.rows;
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: AttendeeRow): string | number => {
      switch (sortKey) {
        case "attendeeName":
          return r.attendeeName.toLowerCase();
        case "ce_date":
          return r.ce_date ?? "";
        case "confirmed_date":
          return r.confirmed_date ?? "";
        case "paid":
          return r.paid ? 1 : 0;
        case "showed_up":
          return r.showed_up ? 1 : 0;
        case "materials_prepared":
          return r.materials_prepared ? 1 : 0;
      }
    };
    return [...base].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // Stable tie-breaker by name.
      return a.attendeeName.localeCompare(b.attendeeName);
    });
  }, [active, sortKey, sortDir, confirmedOnly]);

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">
          No CE events yet.{" "}
          {canEdit
            ? "Create one in the CE Events tab to start rostering CE leads."
            : "CE events will appear here once created."}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      {/* Event selector */}
      <div className="print:hidden">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Events
          </p>
        </div>
        <div className="space-y-1.5">
          {events.map((e) => (
            <button
              key={e.key}
              type="button"
              onClick={() => setSelected(e.key)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                active?.key === e.key
                  ? "border-emerald-300 bg-emerald-50 font-semibold text-emerald-800"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="truncate">{e.name}</span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {e.rows.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Roster for selected event */}
      {active && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 print:border-0">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900">{active.name}</h2>
              {active.event && <EventDetails event={active.event} />}
              <p className="mt-1 text-sm text-slate-500">
                {active.rows.length} attendee
                {active.rows.length === 1 ? "" : "s"}
                {" · "}
                {active.rows.filter((r) => r.confirmed_date).length} confirmed ·{" "}
                {active.rows.filter((r) => r.paid).length} paid ·{" "}
                {active.rows.filter((r) => r.showed_up).length} showed ·{" "}
                {active.rows.filter((r) => r.materials_prepared).length} prepped
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 print:hidden">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setConfirmedOnly(false)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    !confirmedOnly
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmedOnly(true)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    confirmedOnly
                      ? "bg-white text-emerald-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Confirmed
                </button>
              </div>
              {active.event && (
                <button
                  type="button"
                  onClick={() => setShowShare((v) => !v)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition ${
                    showShare
                      ? "border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700"
                      : "border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50"
                  }`}
                >
                  Sign-up QR
                </button>
              )}
              <button
                type="button"
                onClick={() => window.print()}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 print:hidden"
            >
              Print list
            </button>
            </div>
          </div>
          {showShare && active.event && (
            <EventSignupShare event={active.event} />
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-semibold">
                    <button
                      type="button"
                      onClick={() => onSort("attendeeName")}
                      className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ${
                        sortKey === "attendeeName"
                          ? "text-slate-700"
                          : "text-slate-500"
                      }`}
                    >
                      Attendee
                      <span className="text-[10px] leading-none">
                        {sortKey === "attendeeName"
                          ? sortDir === "asc"
                            ? "▲"
                            : "▼"
                          : "↕"}
                      </span>
                    </button>
                  </th>
                  <SortHeader
                    label="CE date"
                    sortKey="ce_date"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={onSort}
                  />
                  <SortHeader
                    label="Confirmed"
                    sortKey="confirmed_date"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={onSort}
                  />
                  <SortHeader
                    label="Paid"
                    sortKey="paid"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={onSort}
                    center
                  />
                  <SortHeader
                    label="Showed"
                    sortKey="showed_up"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={onSort}
                    center
                  />
                  <SortHeader
                    label="Materials"
                    sortKey="materials_prepared"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={onSort}
                    center
                  />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-5 py-2.5 font-medium text-slate-900">
                      {r.attendeeName}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {fmtDate(r.ce_date)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      <span className="print:hidden">
                        {canEdit ? (
                          <span className="flex items-center gap-2">
                            <ToggleCell
                              on={!!r.confirmed_date}
                              busy={!!pending[`${r.id}:confirmed_date`]}
                              canEdit={canEdit}
                              onToggle={() => toggle(r, "confirmed_date")}
                            />
                            <span className="text-xs text-slate-500">
                              {r.confirmed_date ? fmtDate(r.confirmed_date) : ""}
                            </span>
                          </span>
                        ) : (
                          fmtDate(r.confirmed_date)
                        )}
                      </span>
                      <span className="hidden print:inline">
                        {fmtDate(r.confirmed_date)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ToggleCell
                        on={r.paid}
                        busy={!!pending[`${r.id}:paid`]}
                        canEdit={canEdit}
                        onToggle={() => toggle(r, "paid")}
                      />
                      <span className="hidden print:inline">
                        <Check on={r.paid} />
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ToggleCell
                        on={r.showed_up}
                        busy={!!pending[`${r.id}:showed_up`]}
                        canEdit={canEdit}
                        onToggle={() => toggle(r, "showed_up")}
                      />
                      <span className="hidden print:inline">
                        <Check on={r.showed_up} />
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ToggleCell
                        on={r.materials_prepared}
                        busy={!!pending[`${r.id}:materials_prepared`]}
                        canEdit={canEdit}
                        onToggle={() => toggle(r, "materials_prepared")}
                      />
                      <span className="hidden print:inline">
                        <Check on={r.materials_prepared} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {active.rows.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-slate-500 print:hidden">
              No attendees yet. Assign a CE lead below to roster them.
            </p>
          )}
          {active.rows.length > 0 && sortedRows.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-slate-500 print:hidden">
              No confirmed attendees yet. Switch to “All” to see everyone
              reached out to.
            </p>
          )}
          {canEdit && (
            <AssignLead
              event={active.event}
              eventName={active.name}
              contacts={contacts}
              rosteredIds={new Set(active.rows.map((r) => r.contactId))}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Public interest sign-up link + scannable QR code for a CE event. */
function EventSignupShare({ event }: { event: CrmCeEvent }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const qrWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const url = origin ? `${origin}/ce/signup/${event.id}` : "";

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the field is selectable as a fallback.
    }
  }

  function download() {
    const canvas = qrWrapRef.current?.querySelector("canvas");
    if (!canvas) return;
    const slug = event.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "ce-event";
    const link = document.createElement("a");
    link.download = `${slug}-signup-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="border-b border-slate-200 bg-slate-50/60 px-5 py-4 print:hidden">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div
          ref={qrWrapRef}
          className="mx-auto shrink-0 rounded-lg border border-slate-200 bg-white p-2 sm:mx-0"
        >
          {url ? (
            <QRCodeCanvas value={url} size={136} marginSize={2} level="M" />
          ) : (
            <div className="h-[136px] w-[136px]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">
            Interest sign-up link
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Share this link or QR code. Anyone who scans it can register their
            interest in “{event.name}” — new leads land in this event&apos;s
            roster automatically.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm"
            />
            <button
              type="button"
              onClick={copy}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={download}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              Download QR
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact one-line summary of a CE event's logistics + details. */
function EventDetails({ event }: { event: CrmCeEvent }) {
  const time =
    event.start_time && event.end_time
      ? `${event.start_time}–${event.end_time}`
      : event.start_time || event.end_time || null;
  const cost =
    event.cost_type === "paid"
      ? event.cost_amount != null
        ? `Paid · $${event.cost_amount}`
        : "Paid"
      : labelFor(CE_COST_TYPE_OPTIONS, event.cost_type);
  const bits = [
    fmtDate(event.event_date) !== "—" ? fmtDate(event.event_date) : null,
    time,
    event.location,
    event.subject,
    event.presenters ? `Presenter: ${event.presenters}` : null,
    labelFor(CE_AUDIENCE_OPTIONS, event.audience)
      ? `For: ${labelFor(CE_AUDIENCE_OPTIONS, event.audience)}`
      : null,
    cost,
    labelFor(CE_STATUS_OPTIONS, event.status),
  ].filter(Boolean);
  const hours =
    event.ce_hours_total != null
      ? `${event.ce_hours_total} CE hrs`
      : event.ce_hours_medical != null || event.ce_hours_nonmedical != null
        ? `${event.ce_hours_medical ?? 0}/${event.ce_hours_nonmedical ?? 0} med/non-med hrs`
        : null;
  const cebroker = [
    event.tracking_number ? `CEbroker #${event.tracking_number}` : null,
    hours,
    event.race_approved ? "RACE approved" : null,
    labelFor(CE_APPROVAL_STATUS_OPTIONS, event.approval_status),
  ].filter(Boolean);
  return (
    <div className="mt-1 space-y-1">
      <p className="text-sm text-slate-600">{bits.join(" · ")}</p>
      {cebroker.length > 0 && (
        <p className="text-xs font-medium text-slate-500">
          {cebroker.join(" · ")}
        </p>
      )}
      {event.description && (
        <p className="text-sm text-slate-500">{event.description}</p>
      )}
      {event.registration_url && (
        <a
          href={event.registration_url}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm font-medium text-emerald-700 hover:underline print:hidden"
        >
          Registration link
        </a>
      )}
    </div>
  );
}

/** Delete a CE event after confirmation. */
function DeleteEventButton({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          !window.confirm(
            `Delete "${eventName}"? Rostered attendees are kept but detached from this event.`,
          )
        )
          return;
        startTransition(async () => {
          const res = await deleteCeEvent(eventId);
          if (!res.ok) alert(`Could not delete: ${res.error}`);
        });
      }}
      className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

/** Roster an existing CE lead onto the selected event. */
function AssignLead({
  event,
  eventName,
  contacts,
  rosteredIds,
}: {
  event: CrmCeEvent | null;
  eventName: string;
  contacts: CrmContact[];
  rosteredIds: Set<string>;
}) {
  const [contactId, setContactId] = useState("");
  const [pending, startTransition] = useTransition();

  const available = useMemo(
    () =>
      contacts
        .filter((c) => !rosteredIds.has(c.id))
        .map((c) => ({ id: c.id, name: contactName(c) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [contacts, rosteredIds],
  );

  if (!event) {
    return (
      <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400 print:hidden">
        “{eventName}” is a legacy event. Open a lead’s profile to manage their CE
        records.
      </p>
    );
  }

  function add() {
    if (!contactId || !event) return;
    const id = contactId;
    startTransition(async () => {
      const res = await assignLeadToCeEvent(event.id, id);
      if (!res.ok) alert(`Could not assign: ${res.error}`);
      else setContactId("");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-3 print:hidden">
      <span className="text-sm font-medium text-slate-600">Assign CE lead:</span>
      <select
        value={contactId}
        onChange={(e) => setContactId(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <option value="">Select a lead…</option>
        {available.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={add}
        disabled={!contactId || pending}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add"}
      </button>
    </div>
  );
}

/** Stat summary card. */
function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/** Interactive per-event planning/resources checklist (CE Events tab). */
function EventPlanningChecklist({
  event,
  canEdit,
}: {
  event: CrmCeEvent;
  canEdit: boolean;
}) {
  const [state, setState] = useState<Record<string, boolean>>(
    event.planning_checklist ?? {},
  );
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  const total = CE_PLANNING_CHECKLIST.reduce((n, g) => n + g.items.length, 0);
  const done = CE_PLANNING_CHECKLIST.reduce(
    (n, g) => n + g.items.filter((i) => state[i.key]).length,
    0,
  );

  function toggle(key: string) {
    if (!canEdit) return;
    const next = !state[key];
    setState((s) => ({ ...s, [key]: next }));
    setPending((p) => ({ ...p, [key]: true }));
    startTransition(async () => {
      const res = await setCeEventChecklistItem(event.id, key, next);
      setPending((p) => {
        const { [key]: _omit, ...rest } = p;
        return rest;
      });
      if (!res.ok) {
        setState((s) => ({ ...s, [key]: !next }));
        alert(`Could not update: ${res.error}`);
      }
    });
  }

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Planning & resources checklist
        </p>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          {done}/{total} done
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {CE_PLANNING_CHECKLIST.map((section) => (
          <div key={section.group}>
            <p className="text-xs font-semibold text-slate-700">
              {section.group}
            </p>
            <ul className="mt-2 space-y-1.5">
              {section.items.map((item) => (
                <li key={item.key}>
                  <label
                    className={`flex items-start gap-2 text-sm ${
                      canEdit ? "cursor-pointer" : "cursor-default"
                    } ${state[item.key] ? "text-slate-400 line-through" : "text-slate-700"}`}
                  >
                    <input
                      type="checkbox"
                      checked={!!state[item.key]}
                      disabled={!canEdit || !!pending[item.key]}
                      onChange={() => toggle(item.key)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    {item.label}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Expanded field-by-field detail block for an event (CE Events tab). */
function EventDetailGrid({ event }: { event: CrmCeEvent }) {
  const rows: { label: string; value: string | null }[] = [
    {
      label: "Course type",
      value: labelFor(CE_COURSE_TYPE_OPTIONS, event.course_type),
    },
    {
      label: "Delivery method",
      value: labelFor(CE_DELIVERY_METHOD_OPTIONS, event.delivery_method),
    },
    { label: "Tracking #", value: event.tracking_number },
    { label: "Approval board", value: event.approval_board },
    {
      label: "Approval status",
      value: labelFor(CE_APPROVAL_STATUS_OPTIONS, event.approval_status),
    },
    { label: "RACE approved", value: event.race_approved ? "Yes" : null },
    {
      label: "CE hours",
      value:
        event.ce_hours_total != null
          ? `${event.ce_hours_total} total` +
            (event.ce_hours_medical != null ||
            event.ce_hours_nonmedical != null
              ? ` (${event.ce_hours_medical ?? 0} med / ${event.ce_hours_nonmedical ?? 0} non-med)`
              : "")
          : null,
    },
    {
      label: "Effective start",
      value:
        fmtDate(event.effective_start) !== "—"
          ? fmtDate(event.effective_start)
          : null,
    },
    {
      label: "Effective end",
      value:
        fmtDate(event.effective_end) !== "—"
          ? fmtDate(event.effective_end)
          : null,
    },
    {
      label: "Projected offering",
      value:
        fmtDate(event.projected_offering_date) !== "—"
          ? fmtDate(event.projected_offering_date)
          : null,
    },
    {
      label: "Rosters allowed",
      value:
        fmtDate(event.rosters_allowed_date) !== "—"
          ? fmtDate(event.rosters_allowed_date)
          : null,
    },
    { label: "Website", value: event.website_url },
  ].filter((r) => r.value);

  const blocks: { label: string; value: string | null }[] = [
    { label: "Learning objectives", value: event.learning_objectives },
    { label: "Disclosure statements", value: event.disclosure_statements },
    { label: "Presenter bio", value: event.presenter_bio },
    { label: "What's included", value: event.whats_included },
    { label: "Who should attend", value: event.who_should_attend },
  ].filter((b) => b.value);

  if (rows.length === 0 && blocks.length === 0) return null;

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      {rows.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={r.label} className="flex flex-col">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {r.label}
              </dt>
              <dd className="text-sm text-slate-700">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {blocks.length > 0 && (
        <div className="mt-4 space-y-3">
          {blocks.map((b) => (
            <div key={b.label}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {b.label}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">
                {b.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * CE Events management tab — browse events, see full details, create/edit/
 * delete, and work each event's planning & resources checklist. Attendee
 * rostering lives in the separate CE Attendees tab.
 */
function CeEventsManageView({
  events,
  canEdit,
}: {
  events: CrmCeEvent[];
  canEdit: boolean;
}) {
  const sorted = useMemo(
    () => [...events].sort((a, b) => a.name.localeCompare(b.name)),
    [events],
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    sorted[0]?.id ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const active = sorted.find((e) => e.id === selectedId) ?? sorted[0] ?? null;

  if (creating) {
    return (
      <CeEventForm
        onDone={() => setCreating(false)}
        onCancel={() => setCreating(false)}
      />
    );
  }

  if (editing && active) {
    return (
      <CeEventForm
        event={active}
        onDone={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">
          No CE events yet.{" "}
          {canEdit
            ? "Create one to plan and submit it to CEbroker."
            : "CE events will appear here once created."}
        </p>
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            + New CE Event
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      {/* Event selector */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Events
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              + New
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          {sorted.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setSelectedId(e.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                active?.id === e.id
                  ? "border-emerald-300 bg-emerald-50 font-semibold text-emerald-800"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="truncate">{e.name}</span>
              {labelFor(CE_STATUS_OPTIONS, e.status) && (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  {labelFor(CE_STATUS_OPTIONS, e.status)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Details + checklist for selected event */}
      {active && (
        <div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900">
                  {active.name}
                </h2>
                <EventDetails event={active} />
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <DeleteEventButton
                    eventId={active.id}
                    eventName={active.name}
                  />
                </div>
              )}
            </div>
            <EventDetailGrid event={active} />
          </div>
          <EventPlanningChecklist
            key={active.id}
            event={active}
            canEdit={canEdit}
          />
        </div>
      )}
    </div>
  );
}

/** Basic stats sheet: running totals across CE events plus repeat attendees. */
function CeStatsView({
  contacts,
  attendance,
  events: eventEntities,
}: {
  contacts: CrmContact[];
  attendance: CrmCeAttendance[];
  events: CrmCeEvent[];
}) {
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts) m.set(c.id, contactName(c));
    return m;
  }, [contacts]);

  const { eventStats, totals, repeats } = useMemo(() => {
    const byName = new Map<string, CrmCeEvent>();
    for (const ev of eventEntities) byName.set(ev.name, ev);

    type Group = {
      key: string;
      name: string;
      isFree: boolean;
      rows: CrmCeAttendance[];
    };
    const groups = new Map<string, Group>();
    const getGroup = (key: string, name: string, ev: CrmCeEvent | null) => {
      let g = groups.get(key);
      if (!g) {
        g = { key, name, isFree: ev ? ev.cost_type === "free" : false, rows: [] };
        groups.set(key, g);
      }
      return g;
    };

    // Seed every real event so it shows even with zero attendees.
    for (const ev of eventEntities) getGroup(ev.id, ev.name, ev);

    // Track the distinct events each contact attended (for repeat detection).
    const eventsByContact = new Map<string, Set<string>>();

    for (const a of attendance) {
      const matchId =
        a.ce_event_id && eventEntities.some((e) => e.id === a.ce_event_id)
          ? a.ce_event_id
          : !a.ce_event_id && byName.has(a.ce_name)
            ? byName.get(a.ce_name)!.id
            : null;
      let key: string;
      if (matchId) {
        const ev = eventEntities.find((e) => e.id === matchId)!;
        key = matchId;
        getGroup(key, ev.name, ev).rows.push(a);
      } else {
        const name = a.ce_name || "Untitled CE";
        key = `legacy:${name}`;
        getGroup(key, name, null).rows.push(a);
      }
      const set = eventsByContact.get(a.contact_id) ?? new Set<string>();
      set.add(key);
      eventsByContact.set(a.contact_id, set);
    }

    const eventStats = Array.from(groups.values())
      .map((g) => ({
        key: g.key,
        name: g.name,
        isFree: g.isFree,
        onList: g.rows.length,
        paid: g.rows.filter((r) => r.paid).length,
        checkedIn: g.rows.filter((r) => r.showed_up).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const totals = {
      events: eventStats.length,
      onList: attendance.length,
      paid: attendance.filter((r) => r.paid).length,
      checkedIn: attendance.filter((r) => r.showed_up).length,
    };

    const repeats = Array.from(eventsByContact.entries())
      .filter(([, set]) => set.size > 1)
      .map(([contactId, set]) => ({
        contactId,
        name: nameById.get(contactId) ?? "Unknown",
        count: set.size,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return { eventStats, totals, repeats };
  }, [attendance, eventEntities, nameById]);

  return (
    <div className="space-y-6">
      {/* Running totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="CE Events" value={totals.events} />
        <StatCard
          label="On the list"
          value={totals.onList}
          sub="total roster entries"
        />
        <StatCard
          label="Checked in"
          value={totals.checkedIn}
          sub={
            totals.onList
              ? `${Math.round((totals.checkedIn / totals.onList) * 100)}% of list`
              : undefined
          }
        />
        <StatCard label="Paid" value={totals.paid} sub="across all events" />
      </div>

      {/* Per-event breakdown */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">By event</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 font-semibold">Event</th>
                <th className="px-3 py-2.5 text-center font-semibold">On list</th>
                <th className="px-3 py-2.5 text-center font-semibold">Paid</th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Checked in
                </th>
              </tr>
            </thead>
            <tbody>
              {eventStats.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-5 py-6 text-center text-slate-500"
                  >
                    No CE events yet.
                  </td>
                </tr>
              ) : (
                eventStats.map((e) => (
                  <tr
                    key={e.key}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-5 py-2.5 font-medium text-slate-900">
                      {e.name}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-700">
                      {e.onList}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-700">
                      {e.isFree ? (
                        <span className="text-slate-400">N/A</span>
                      ) : (
                        e.paid
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-700">
                      {e.checkedIn}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {eventStats.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 text-sm font-semibold text-slate-900">
                  <td className="px-5 py-2.5">Total</td>
                  <td className="px-3 py-2.5 text-center">{totals.onList}</td>
                  <td className="px-3 py-2.5 text-center">{totals.paid}</td>
                  <td className="px-3 py-2.5 text-center">{totals.checkedIn}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Repeat attendees */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Multiple-event attendees
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            People who appear on more than one CE event roster
          </p>
        </div>
        {repeats.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-slate-500">
            No one has attended multiple events yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {repeats.map((r) => (
              <li
                key={r.contactId}
                className="flex items-center justify-between px-5 py-2.5 text-sm"
              >
                <span className="font-medium text-slate-900">{r.name}</span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  {r.count} events
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function CeCrmTabs({
  contacts,
  attendance,
  events,
  canEdit,
}: {
  contacts: CrmContact[];
  attendance: CrmCeAttendance[];
  events: CrmCeEvent[];
  canEdit: boolean;
}) {
  const [tab, setTab] = useState<
    "leads" | "attendees" | "events" | "stats"
  >("leads");

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5 inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm print:hidden">
        <button
          type="button"
          onClick={() => setTab("leads")}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
            tab === "leads"
              ? "bg-emerald-600 text-white shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          CE Leads
        </button>
        <button
          type="button"
          onClick={() => setTab("attendees")}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
            tab === "attendees"
              ? "bg-emerald-600 text-white shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          CE Attendees
        </button>
        <button
          type="button"
          onClick={() => setTab("events")}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
            tab === "events"
              ? "bg-emerald-600 text-white shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          CE Events
        </button>
        <button
          type="button"
          onClick={() => setTab("stats")}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
            tab === "stats"
              ? "bg-emerald-600 text-white shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Stats
        </button>
      </div>

      {tab === "leads" ? (
        <ContactListView
          contacts={contacts}
          title="CE Leads"
          description="Everyone we've reached out to — QR sign-ups, manual entries & uploads"
          icon="📋"
          variant="ce"
          addHref="/crm/contact/new?type=ce_attendee"
        />
      ) : tab === "attendees" ? (
        <CeAttendeesView
          contacts={contacts}
          attendance={attendance}
          events={events}
          canEdit={canEdit}
        />
      ) : tab === "events" ? (
        <CeEventsManageView events={events} canEdit={canEdit} />
      ) : (
        <CeStatsView contacts={contacts} attendance={attendance} events={events} />
      )}
    </div>
  );
}
