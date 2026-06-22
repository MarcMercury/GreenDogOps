"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { CrmContact, CrmCeAttendance } from "@/lib/crm/types";
import { ContactListView } from "../crm-views";
import { setCeAttendanceField } from "../actions";

type AttendeeRow = CrmCeAttendance & { attendeeName: string; contactId: string };

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


function CeEventsView({
  contacts,
  attendance,
  canEdit,
}: {
  contacts: CrmContact[];
  attendance: CrmCeAttendance[];
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

  // Group attendance rows by CE event name.
  const events = useMemo(() => {
    const groups = new Map<string, AttendeeRow[]>();
    for (const a of rows) {
      const key = a.ce_name || "Untitled CE";
      const list = groups.get(key) ?? [];
      list.push({
        ...a,
        contactId: a.contact_id,
        attendeeName: nameById.get(a.contact_id) ?? "Unknown",
      });
      groups.set(key, list);
    }
    return Array.from(groups.entries())
      .map(([name, list]) => ({
        name,
        rows: list.sort((a, b) => a.attendeeName.localeCompare(b.attendeeName)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, nameById]);


  const [selected, setSelected] = useState<string | null>(
    events[0]?.name ?? null,
  );
  const active = events.find((e) => e.name === selected) ?? events[0] ?? null;

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
    return [...active.rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // Stable tie-breaker by name.
      return a.attendeeName.localeCompare(b.attendeeName);
    });
  }, [active, sortKey, sortDir]);

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No CE events recorded yet. Add CE events from a lead’s profile to roster
        attendees here.
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      {/* Event selector */}
      <div className="print:hidden">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          CE Events
        </p>
        <div className="space-y-1.5">
          {events.map((e) => (
            <button
              key={e.name}
              type="button"
              onClick={() => setSelected(e.name)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                active?.name === e.name
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 print:border-0">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{active.name}</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {active.rows.length} attendee
                {active.rows.length === 1 ? "" : "s"}
                {" · "}
                {active.rows.filter((r) => r.paid).length} paid ·{" "}
                {active.rows.filter((r) => r.showed_up).length} showed ·{" "}
                {active.rows.filter((r) => r.materials_prepared).length} prepped
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 print:hidden"
            >
              Print list
            </button>
          </div>
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
        </div>
      )}
    </div>
  );
}

export function CeCrmTabs({
  contacts,
  attendance,
  canEdit,
}: {
  contacts: CrmContact[];
  attendance: CrmCeAttendance[];
  canEdit: boolean;
}) {
  const [tab, setTab] = useState<"leads" | "events">("leads");

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
          Leads
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
      </div>

      {tab === "leads" ? (
        <ContactListView
          contacts={contacts}
          title="CE Leads"
          description="Continuing-education event attendees & leads"
          icon="📋"
          variant="ce"
        />
      ) : (
        <CeEventsView contacts={contacts} attendance={attendance} canEdit={canEdit} />
      )}
    </div>
  );
}
