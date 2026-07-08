"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, EventInput } from "@fullcalendar/core";
import type { DateClickArg } from "@fullcalendar/interaction";
import {
  type CalendarItem,
  type CalendarCategory,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  CATEGORY_TONE,
} from "@/lib/calendar/types";
import {
  createCustomEvent,
  updateCustomEvent,
  deleteCustomEvent,
} from "./actions";

const LEGEND: CalendarCategory[] = [
  "google",
  "general",
  "ce",
  "interview",
  "time_off",
];

type EditState =
  | { mode: "closed" }
  | { mode: "create"; date: string | null }
  | { mode: "edit"; item: CalendarItem };

export function CalendarView({
  items,
  canEdit,
}: {
  items: CalendarItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<EditState>({ mode: "closed" });

  const events = useMemo<EventInput[]>(
    () =>
      items.map((it) => ({
        id: it.id,
        title: it.title,
        start: it.start,
        end: it.end ?? undefined,
        allDay: it.allDay,
        backgroundColor: CATEGORY_COLORS[it.category],
        borderColor: CATEGORY_COLORS[it.category],
        extendedProps: { item: it },
      })),
    [items],
  );

  function onEventClick(arg: EventClickArg) {
    const item = arg.event.extendedProps.item as CalendarItem;
    if (item.editable) {
      setEdit({ mode: "edit", item });
    } else if (item.href) {
      router.push(item.href);
    }
  }

  function onDateClick(arg: DateClickArg) {
    if (!canEdit) return;
    setEdit({ mode: "create", date: arg.dateStr.slice(0, 10) });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {LEGEND.map((c) => (
            <span
              key={c}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${CATEGORY_TONE[c]}`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[c] }}
                aria-hidden
              />
              {CATEGORY_LABELS[c]}
            </span>
          ))}
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEdit({ mode: "create", date: null })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
          >
            + Add event
          </button>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <FullCalendar
          plugins={[
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
          ]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,listWeek",
          }}
          height="auto"
          events={events}
          eventClick={onEventClick}
          dateClick={onDateClick}
          dayMaxEvents={3}
          nowIndicator
          eventTimeFormat={{
            hour: "numeric",
            minute: "2-digit",
            meridiem: "short",
          }}
        />
      </div>

      {edit.mode !== "closed" ? (
        <EventDialog
          state={edit}
          onClose={() => setEdit({ mode: "closed" })}
          onSaved={() => {
            setEdit({ mode: "closed" });
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function EventDialog({
  state,
  onClose,
  onSaved,
}: {
  state: Exclude<EditState, { mode: "closed" }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = state.mode === "edit";
  const item = isEdit ? state.item : null;
  const initialDate =
    state.mode === "create" ? state.date : item!.start.slice(0, 10);
  const initialAllDay = item?.allDay ?? true;

  const [allDay, setAllDay] = useState(initialAllDay);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function timePart(iso: string | null): string {
    if (!iso) return "";
    const t = iso.split("T")[1];
    return t ? t.slice(0, 5) : "";
  }

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = isEdit
        ? await updateCustomEvent(formData)
        : await createCustomEvent(formData);
      if (res.ok) onSaved();
      else setError(res.error);
    });
  }

  function remove() {
    if (!item) return;
    setError(null);
    const fd = new FormData();
    fd.set("id", stripSource(item.id));
    startTransition(async () => {
      const res = await deleteCustomEvent(fd);
      if (res.ok) onSaved();
      else setError(res.error);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-slate-900">
          {isEdit ? "Edit event" : "New event"}
        </h2>
        <form action={submit} className="mt-4 space-y-3">
          {isEdit ? (
            <input type="hidden" name="id" value={stripSource(item!.id)} />
          ) : null}
          <Field label="Title">
            <input
              name="title"
              required
              defaultValue={item?.title ?? ""}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="all_day"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            All day
          </label>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <input
                type="date"
                name="start_date"
                required
                defaultValue={initialDate ?? ""}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            {!allDay ? (
              <Field label="Start time">
                <input
                  type="time"
                  name="start_time"
                  defaultValue={timePart(item?.start ?? null)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </Field>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="End date">
              <input
                type="date"
                name="end_date"
                defaultValue={item?.end ? item.end.slice(0, 10) : ""}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            {!allDay ? (
              <Field label="End time">
                <input
                  type="time"
                  name="end_time"
                  defaultValue={timePart(item?.end ?? null)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </Field>
            ) : null}
          </div>

          <Field label="Location">
            <input
              name="location"
              defaultValue={item?.location ?? ""}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Description">
            <textarea
              name="description"
              rows={2}
              defaultValue={item?.description ?? ""}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>

          {error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : null}

          <div className="flex items-center justify-between pt-1">
            {isEdit ? (
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                Delete
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Strip the "source:" prefix from a CalendarItem id to get the raw row id. */
function stripSource(id: string): string {
  const idx = id.indexOf(":");
  return idx === -1 ? id : id.slice(idx + 1);
}
