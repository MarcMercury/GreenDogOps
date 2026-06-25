"use client";

import { useActionState, useEffect } from "react";
import {
  createCeEvent,
  updateCeEvent,
  type SaveResult,
} from "../actions";
import { Field, Select, ComboField, TextArea, SaveButton } from "../form-fields";
import {
  CE_AUDIENCE_OPTIONS,
  CE_COST_TYPE_OPTIONS,
  CE_STATUS_OPTIONS,
  CE_SUBJECT_SUGGESTIONS,
  type CrmCeEvent,
} from "@/lib/crm/types";

export function CeEventForm({
  event,
  onDone,
  onCancel,
}: {
  event?: CrmCeEvent;
  onDone: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!event;
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) =>
      isEdit ? updateCeEvent(event!.id, prev, fd) : createCeEvent(prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) onDone();
  }, [result, onDone]);

  return (
    <form
      action={formAction}
      className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5"
    >
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {isEdit ? "Edit CE Event" : "New CE Event"}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Event name" name="name" defaultValue={event?.name} />
        </div>
        <Field label="Date" name="event_date" type="date" defaultValue={event?.event_date} />
        <Field label="Start time" name="start_time" type="time" defaultValue={event?.start_time} />
        <Field label="End time" name="end_time" type="time" defaultValue={event?.end_time} />
        <Field label="Location" name="location" defaultValue={event?.location} />
        <ComboField
          label="Subject"
          name="subject"
          defaultValue={event?.subject}
          options={CE_SUBJECT_SUGGESTIONS as unknown as string[]}
          placeholder="e.g. Dentistry"
        />
        <Field label="Presenter(s)" name="presenters" defaultValue={event?.presenters} />
        <Select
          label="For (audience)"
          name="audience"
          defaultValue={event?.audience}
          options={CE_AUDIENCE_OPTIONS}
        />
        <Select
          label="Cost"
          name="cost_type"
          defaultValue={event?.cost_type ?? "free"}
          options={CE_COST_TYPE_OPTIONS}
        />
        <Field
          label="Price ($, if paid)"
          name="cost_amount"
          type="number"
          defaultValue={event?.cost_amount}
        />
        <Select
          label="Status"
          name="status"
          defaultValue={event?.status ?? "planned"}
          options={CE_STATUS_OPTIONS}
        />
        <Field
          label="Capacity"
          name="capacity"
          type="number"
          defaultValue={event?.capacity}
        />
        <Field
          label="Registration link"
          name="registration_url"
          defaultValue={event?.registration_url}
        />
        <TextArea label="Description" name="description" defaultValue={event?.description} />
        <TextArea label="Notes" name="notes" defaultValue={event?.notes} />
      </div>
      {result?.ok === false && (
        <p className="mt-3 text-sm text-red-600">{result.error}</p>
      )}
      <div className="mt-4 flex items-center gap-3">
        <SaveButton label={isEdit ? "Save event" : "Create event"} />
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
