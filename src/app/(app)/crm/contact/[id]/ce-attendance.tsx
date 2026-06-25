"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { CrmCeAttendance, CrmCeEvent } from "@/lib/crm/types";
import {
  addCeAttendance,
  updateCeAttendance,
  deleteCeAttendance,
  type SaveResult,
} from "../../actions";

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

function StatusDot({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        on ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          on ? "bg-emerald-500" : "bg-slate-300"
        }`}
      />
      {label}
    </span>
  );
}

function RowSaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

function CheckBox({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked ?? false}
        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
      />
      {label}
    </label>
  );
}

function AttendanceFields({
  record,
  events,
}: {
  record?: CrmCeAttendance;
  events: CrmCeEvent[];
}) {
  const [eventId, setEventId] = useState(record?.ce_event_id ?? "");
  const [ceName, setCeName] = useState(record?.ce_name ?? "");
  const [ceDate, setCeDate] = useState(record?.ce_date ?? "");

  function onPickEvent(id: string) {
    setEventId(id);
    const ev = events.find((e) => e.id === id);
    if (ev) {
      setCeName(ev.name);
      setCeDate(ev.event_date ?? "");
    }
  }

  return (
    <>
      <input type="hidden" name="ce_event_id" value={eventId} />
      {events.length > 0 && (
        <label className="mb-3 flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">
            Link to CE event
          </span>
          <select
            value={eventId}
            onChange={(e) => onPickEvent(e.target.value)}
            className={inputCls}
          >
            <option value="">— New / unlisted CE —</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.event_date ? ` (${e.event_date})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 lg:col-span-2">
          <span className="text-xs font-medium text-slate-500">CE name</span>
          <input
            name="ce_name"
            required
            value={ceName}
            onChange={(e) => setCeName(e.target.value)}
            placeholder="e.g. Spring Dental CE"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">CE date</span>
          <input
            name="ce_date"
            type="date"
            value={ceDate}
            onChange={(e) => setCeDate(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">
            Date confirmed
          </span>
          <input
            name="confirmed_date"
            type="date"
            defaultValue={record?.confirmed_date ?? ""}
            className={inputCls}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-5">
        <CheckBox name="paid" label="Paid" defaultChecked={record?.paid} />
        <CheckBox
          name="showed_up"
          label="Showed up"
          defaultChecked={record?.showed_up}
        />
        <CheckBox
          name="materials_prepared"
          label="Materials prepared"
          defaultChecked={record?.materials_prepared}
        />
      </div>
    </>
  );
}

function ExistingRow({
  record,
  events,
  canEdit,
}: {
  record: CrmCeAttendance;
  events: CrmCeEvent[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [deletePending, startDelete] = useTransition();
  const router = useRouter();
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => updateCeAttendance(record.id, record.contact_id, prev, fd),
    null,
  );

  if (editing) {
    return (
      <form
        action={async (fd) => {
          await formAction(fd);
          setEditing(false);
        }}
        className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4"
      >
        <AttendanceFields record={record} events={events} />
        {result?.ok === false && (
          <p className="mt-2 text-sm text-red-600">{result.error}</p>
        )}
        <div className="mt-3 flex items-center gap-3">
          <RowSaveButton label="Save" />
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{record.ce_name}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          CE {fmtDate(record.ce_date)} · Confirmed{" "}
          {fmtDate(record.confirmed_date)}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatusDot on={record.paid} label="Paid" />
          <StatusDot on={record.showed_up} label="Showed up" />
          <StatusDot on={record.materials_prepared} label="Materials" />
        </div>
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={deletePending}
            onClick={() => {
              if (!window.confirm(`Remove "${record.ce_name}" from this lead?`))
                return;
              startDelete(async () => {
                await deleteCeAttendance(record.id, record.contact_id);
                router.refresh();
              });
            }}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {deletePending ? "Removing…" : "Remove"}
          </button>
        </div>
      )}
    </div>
  );
}

export function CeAttendanceManager({
  contactId,
  records,
  events,
  canEdit = false,
}: {
  contactId: string;
  records: CrmCeAttendance[];
  events: CrmCeEvent[];
  canEdit?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => addCeAttendance(contactId, prev, fd),
    null,
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          CE Management
        </h2>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            + Add CE
          </button>
        )}
      </div>

      {records.length === 0 && !adding && (
        <p className="text-sm text-slate-500">
          No CE events yet. Use “Add CE” to record one.
        </p>
      )}

      <div className="space-y-3">
        {records.map((r) => (
          <ExistingRow key={r.id} record={r} events={events} canEdit={canEdit} />
        ))}
      </div>

      {adding && (
        <form
          action={async (fd) => {
            await formAction(fd);
            setAdding(false);
          }}
          className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4"
        >
          <AttendanceFields events={events} />
          {result?.ok === false && (
            <p className="mt-2 text-sm text-red-600">{result.error}</p>
          )}
          <div className="mt-3 flex items-center gap-3">
            <RowSaveButton label="Add CE" />
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
