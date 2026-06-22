"use client";

import { useMemo, useState } from "react";
import type { CrmContact, CrmCeAttendance } from "@/lib/crm/types";
import { ContactListView } from "../crm-views";

type AttendeeRow = CrmCeAttendance & { attendeeName: string; contactId: string };

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

function CeEventsView({
  contacts,
  attendance,
}: {
  contacts: CrmContact[];
  attendance: CrmCeAttendance[];
}) {
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts) m.set(c.id, contactName(c));
    return m;
  }, [contacts]);

  // Group attendance rows by CE event name.
  const events = useMemo(() => {
    const groups = new Map<string, AttendeeRow[]>();
    for (const a of attendance) {
      const key = a.ce_name || "Untitled CE";
      const rows = groups.get(key) ?? [];
      rows.push({
        ...a,
        contactId: a.contact_id,
        attendeeName: nameById.get(a.contact_id) ?? "Unknown",
      });
      groups.set(key, rows);
    }
    return Array.from(groups.entries())
      .map(([name, rows]) => ({
        name,
        rows: rows.sort((a, b) => a.attendeeName.localeCompare(b.attendeeName)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [attendance, nameById]);

  const [selected, setSelected] = useState<string | null>(
    events[0]?.name ?? null,
  );
  const active = events.find((e) => e.name === selected) ?? events[0] ?? null;

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
                  <th className="px-5 py-2.5 font-semibold">Attendee</th>
                  <th className="px-3 py-2.5 font-semibold">CE date</th>
                  <th className="px-3 py-2.5 font-semibold">Confirmed</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Paid</th>
                  <th className="px-3 py-2.5 text-center font-semibold">
                    Showed
                  </th>
                  <th className="px-3 py-2.5 text-center font-semibold">
                    Materials
                  </th>
                </tr>
              </thead>
              <tbody>
                {active.rows.map((r) => (
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
                      {fmtDate(r.confirmed_date)}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Check on={r.paid} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Check on={r.showed_up} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Check on={r.materials_prepared} />
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
}: {
  contacts: CrmContact[];
  attendance: CrmCeAttendance[];
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
        <CeEventsView contacts={contacts} attendance={attendance} />
      )}
    </div>
  );
}
