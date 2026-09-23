"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, EventInput } from "@fullcalendar/core";
import type { DateClickArg } from "@fullcalendar/interaction";
import {
  type MarketingEvent,
  type MarketingEventSource,
  type MarketingEventAttendee,
  type PersonOption,
  type CrmOrgRef,
  EVENT_STATUSES,
} from "@/lib/marketing/types";
import { PageHeader } from "../../_components/ui";
import { EventsTab, EventDialog, type Run } from "../marketing-events";
import { CeEventDialog } from "../ce-event-dialog";
import { EventLeadsTab } from "./event-leads";
import type { QrCode, QrForm, QrLead } from "@/lib/marketing/qr";
import {
  type CeEventSummary,
  type UnifiedEvent,
  buildUnifiedEvents,
} from "@/lib/marketing/event-rows";

type ViewKey = "list" | "calendar" | "leads";

const VIEWS: { key: ViewKey; label: string; icon: string }[] = [
  { key: "list", label: "List View", icon: "📋" },
  { key: "calendar", label: "Calendar View", icon: "📅" },
  { key: "leads", label: "Event Leads", icon: "📲" },
];

/** Calendar chips need real colors; the list view uses Tailwind classes. */
const STATUS_HEX: Record<string, string> = {
  idea: "#94a3b8",
  researching: "#64748b",
  tentative: "#0ea5e9",
  planning: "#f59e0b",
  prepping: "#8b5cf6",
  confirmed: "#10b981",
  completed: "#6366f1",
  cancelled: "#ef4444",
};

function addDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function EventsWorkspace({
  canEdit,
  events,
  ceEvents,
  sources,
  attendees,
  people,
  crmOrgs,
  qrCodes,
  qrForms,
  leads,
  initialView,
}: {
  canEdit: boolean;
  events: MarketingEvent[];
  ceEvents: CeEventSummary[];
  sources: MarketingEventSource[];
  attendees: MarketingEventAttendee[];
  people: PersonOption[];
  crmOrgs: CrmOrgRef[];
  qrCodes: QrCode[];
  qrForms: QrForm[];
  leads: QrLead[];
  initialView?: string;
}) {
  const [view, setView] = useState<ViewKey>(
    VIEWS.some((v) => v.key === initialView) ? (initialView as ViewKey) : "list",
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Event Management"
        description="Scout a source → create an event → plan, promote & staff it → recap the results."
      />

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={`-mb-px rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-medium transition ${
              view === v.key
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <span className="mr-1.5" aria-hidden>
              {v.icon}
            </span>
            {v.label}
          </button>
        ))}
      </div>

      {view === "list" ? (
        <EventsTab
          canEdit={canEdit}
          events={events}
          ceEvents={ceEvents}
          sources={sources}
          attendees={attendees}
          crmOrgs={crmOrgs}
          people={people}
          qrCodes={qrCodes}
          qrForms={qrForms}
        />
      ) : view === "calendar" ? (
        <EventsCalendar
          canEdit={canEdit}
          events={events}
          ceEvents={ceEvents}
          sources={sources}
          attendees={attendees}
          people={people}
          qrCodes={qrCodes}
          qrForms={qrForms}
        />
      ) : (
        <EventLeadsTab
          leads={leads}
          events={events}
          ceEvents={ceEvents}
          qrCodes={qrCodes}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function EventsCalendar({
  canEdit,
  events,
  ceEvents,
  sources,
  attendees,
  people,
  qrCodes,
  qrForms,
}: {
  canEdit: boolean;
  events: MarketingEvent[];
  ceEvents: CeEventSummary[];
  sources: MarketingEventSource[];
  attendees: MarketingEventAttendee[];
  people: PersonOption[];
  qrCodes: QrCode[];
  qrForms: QrForm[];
}) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<MarketingEvent | null>(null);
  const [viewingCe, setViewingCe] = useState<CeEventSummary | null>(null);
  const [creatingOn, setCreatingOn] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showCe, setShowCe] = useState(true);

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

  const attendeesByEvent = useMemo(() => {
    const m = new Map<string, MarketingEventAttendee[]>();
    for (const a of attendees) {
      const list = m.get(a.event_id) ?? [];
      list.push(a);
      m.set(a.event_id, list);
    }
    return m;
  }, [attendees]);

  const rows = useMemo(
    () => buildUnifiedEvents(events, showCe ? ceEvents : []),
    [events, ceEvents, showCe],
  );

  const undated = useMemo(() => rows.filter((e) => !e.startsOn), [rows]);

  const calendarEvents = useMemo<EventInput[]>(
    () =>
      rows
        .filter((e) => e.startsOn && !hidden.has(e.status))
        .map((e) => {
          // CE courses keep one identity colour so they read as a programme,
          // not as another marketing status.
          const color = e.kind === "ce" ? "#4f46e5" : STATUS_HEX[e.status] ?? "#64748b";
          return {
            id: e.key,
            title: e.kind === "ce" ? `CE: ${e.name}` : e.name,
            start: e.startsOn!,
            // FullCalendar treats all-day `end` as exclusive.
            end: e.endsOn ? addDay(e.endsOn) : undefined,
            allDay: true,
            backgroundColor: color,
            borderColor: color,
            extendedProps: { row: e },
          };
        }),
    [rows, hidden],
  );

  function toggleStatus(status: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  function openRow(row: UnifiedEvent) {
    if (row.kind === "ce") setViewingCe(row.ce);
    else setEditing(row.marketing);
  }

  function onEventClick(arg: EventClickArg) {
    const row = arg.event.extendedProps.row as UnifiedEvent | undefined;
    if (row) openRow(row);
  }

  function onDateClick(arg: DateClickArg) {
    if (canEdit) setCreatingOn(arg.dateStr);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {EVENT_STATUSES.map((s) => {
            const off = hidden.has(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => toggleStatus(s.value)}
                aria-pressed={!off}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  off
                    ? "border-slate-200 bg-white text-slate-400"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
                title={off ? `Show ${s.label}` : `Hide ${s.label}`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: off
                      ? "transparent"
                      : STATUS_HEX[s.value] ?? "#64748b",
                    boxShadow: off
                      ? `inset 0 0 0 1.5px ${STATUS_HEX[s.value] ?? "#64748b"}`
                      : undefined,
                  }}
                  aria-hidden
                />
                {s.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setShowCe((v) => !v)}
            aria-pressed={showCe}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
              showCe
                ? "border-indigo-300 bg-white text-indigo-700"
                : "border-slate-200 bg-white text-slate-400"
            }`}
            title={showCe ? "Hide CE courses" : "Show CE courses"}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: showCe ? "#4f46e5" : "transparent",
                boxShadow: showCe ? undefined : "inset 0 0 0 1.5px #4f46e5",
              }}
              aria-hidden
            />
            CE courses
          </button>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreatingOn("")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700"
          >
            + Event
          </button>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <FullCalendar
          plugins={[dayGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,dayGridWeek,listMonth",
          }}
          buttonText={{ today: "Today", month: "Month", week: "Week", list: "List" }}
          events={calendarEvents}
          eventClick={onEventClick}
          dateClick={onDateClick}
          height="auto"
          dayMaxEvents={4}
          eventDisplay="block"
          displayEventTime={false}
        />
      </div>

      {undated.length > 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Date TBD ({undated.length})
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {undated.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => openRow(e)}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700"
                title={`${e.typeLabel} · ${e.statusLabel}`}
              >
                {e.kind === "ce" ? "📋 " : ""}
                {e.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {(editing || creatingOn !== null) && (
        <EventDialog
          event={editing}
          defaultDate={creatingOn || null}
          sources={sources}
          attendees={editing ? attendeesByEvent.get(editing.id) ?? [] : []}
          canEdit={canEdit}
          people={people}
          qrCodes={qrCodes}
          qrForms={qrForms}
          onClose={() => {
            setEditing(null);
            setCreatingOn(null);
          }}
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

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </section>
  );
}
