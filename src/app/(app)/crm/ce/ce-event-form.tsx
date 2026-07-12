"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createCeEvent,
  updateCeEvent,
  type SaveResult,
} from "../actions";
import {
  Field,
  Select,
  ComboField,
  TextArea,
  Checkbox,
  SaveButton,
} from "../form-fields";
import {
  CE_AUDIENCE_OPTIONS,
  CE_COST_TYPE_OPTIONS,
  CE_STATUS_OPTIONS,
  CE_SUBJECT_SUGGESTIONS,
  CE_COURSE_TYPE_OPTIONS,
  CE_DELIVERY_METHOD_OPTIONS,
  CE_APPROVAL_STATUS_OPTIONS,
  CE_APPROVAL_BOARD_SUGGESTIONS,
  CE_PLANNING_CHECKLIST,
  type CrmCeEvent,
} from "@/lib/crm/types";

// Wizard steps mirror the GDD CE workflow: build the CEbroker course record,
// capture the RACE/AAVSB approval + credits, plan presenter & event logistics,
// then publish and track the remaining operational steps.
const STEPS = [
  {
    title: "Course basics",
    blurb: "The core course record submitted to CEbroker.",
  },
  {
    title: "RACE approval & credits",
    blurb: "AAVSB / RACE submission details and granted CE hours.",
  },
  {
    title: "Presenters & logistics",
    blurb: "Who's teaching, and how the event runs on the day.",
  },
  {
    title: "Publish & next steps",
    blurb: "Go live and track the remaining setup checklist.",
  },
] as const;

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
  const [step, setStep] = useState(0);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) =>
      isEdit ? updateCeEvent(event!.id, prev, fd) : createCeEvent(prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) onDone();
  }, [result, onDone]);

  const isLast = step === STEPS.length - 1;

  return (
    <form
      action={formAction}
      className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {isEdit ? "Edit CE Event" : "New CE Event"}
          </h3>
          <p className="mt-0.5 text-sm text-slate-500">{STEPS[step].blurb}</p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500 shadow-sm">
          Step {step + 1} of {STEPS.length}
        </span>
      </div>

      {/* Step indicator */}
      <ol className="mb-5 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => setStep(i)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                i === step
                  ? "border-emerald-400 bg-emerald-600 text-white shadow-sm"
                  : i < step
                    ? "border-emerald-300 bg-white text-emerald-700"
                    : "border-slate-200 bg-white text-slate-500"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                  i === step
                    ? "bg-white text-emerald-700"
                    : i < step
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                }`}
              >
                {i + 1}
              </span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>

      {/* Step 1 — Course basics */}
      <div hidden={step !== 0}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <Field
              label="Course title"
              name="name"
              defaultValue={event?.name}
            />
          </div>
          <ComboField
            label="Subject area"
            name="subject"
            defaultValue={event?.subject}
            options={CE_SUBJECT_SUGGESTIONS as unknown as string[]}
            placeholder="e.g. Ultrasound / Imaging"
          />
          <Select
            label="Course type (CEbroker)"
            name="course_type"
            defaultValue={event?.course_type}
            options={CE_COURSE_TYPE_OPTIONS}
          />
          <Select
            label="Delivery method (CEbroker)"
            name="delivery_method"
            defaultValue={event?.delivery_method}
            options={CE_DELIVERY_METHOD_OPTIONS}
          />
          <TextArea
            label="Description"
            name="description"
            defaultValue={event?.description}
          />
          <TextArea
            label="Learning objectives"
            name="learning_objectives"
            defaultValue={event?.learning_objectives}
          />
          <TextArea
            label="Disclosure statements"
            name="disclosure_statements"
            defaultValue={event?.disclosure_statements}
          />
        </div>
      </div>

      {/* Step 2 — RACE approval & credits */}
      <div hidden={step !== 1}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Tracking number (CEbroker)"
            name="tracking_number"
            defaultValue={event?.tracking_number}
          />
          <ComboField
            label="Approval board"
            name="approval_board"
            defaultValue={event?.approval_board}
            options={CE_APPROVAL_BOARD_SUGGESTIONS as unknown as string[]}
            placeholder="e.g. AAVSB / RACE"
          />
          <Select
            label="Approval status"
            name="approval_status"
            defaultValue={event?.approval_status ?? "not_submitted"}
            options={CE_APPROVAL_STATUS_OPTIONS}
          />
          <Field
            label="Total CE hours"
            name="ce_hours_total"
            type="number"
            defaultValue={event?.ce_hours_total}
          />
          <Field
            label="Medical CE hours"
            name="ce_hours_medical"
            type="number"
            defaultValue={event?.ce_hours_medical}
          />
          <Field
            label="Non-medical CE hours"
            name="ce_hours_nonmedical"
            type="number"
            defaultValue={event?.ce_hours_nonmedical}
          />
          <div className="flex items-end pb-2">
            <Checkbox
              label="RACE approved"
              name="race_approved"
              defaultChecked={event?.race_approved}
            />
          </div>
        </div>
      </div>

      {/* Step 3 — Presenters & logistics */}
      <div hidden={step !== 2}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Presenter(s)"
            name="presenters"
            defaultValue={event?.presenters}
          />
          <Field
            label="Public website / info URL"
            name="website_url"
            defaultValue={event?.website_url}
          />
          <Field
            label="Registration link"
            name="registration_url"
            defaultValue={event?.registration_url}
          />
          <TextArea
            label="Presenter bio"
            name="presenter_bio"
            defaultValue={event?.presenter_bio}
          />
          <Field
            label="Start date"
            name="event_date"
            type="date"
            defaultValue={event?.event_date}
          />
          <Field
            label="End date"
            name="end_date"
            type="date"
            defaultValue={event?.end_date}
          />
          <Field
            label="Start time"
            name="start_time"
            type="time"
            defaultValue={event?.start_time}
          />
          <Field
            label="End time"
            name="end_time"
            type="time"
            defaultValue={event?.end_time}
          />
          <Field
            label="Location"
            name="location"
            defaultValue={event?.location}
          />
          <Select
            label="For (audience)"
            name="audience"
            defaultValue={event?.audience}
            options={CE_AUDIENCE_OPTIONS}
          />
          <Field
            label="Capacity / spots"
            name="capacity"
            type="number"
            defaultValue={event?.capacity}
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
          <div className="flex items-end pb-2">
            <Checkbox
              label="Vet social dinner"
              name="social_dinner"
              defaultChecked={event?.social_dinner}
            />
          </div>
          <TextArea
            label="What's included"
            name="whats_included"
            defaultValue={event?.whats_included}
          />
          <TextArea
            label="Who should attend"
            name="who_should_attend"
            defaultValue={event?.who_should_attend}
          />
        </div>
      </div>

      {/* Step 4 — Publish & next steps */}
      <div hidden={step !== 3}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Status"
            name="status"
            defaultValue={event?.status ?? "planned"}
            options={CE_STATUS_OPTIONS}
          />
          <TextArea label="Notes" name="notes" defaultValue={event?.notes} />
        </div>
        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Remaining setup checklist
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Once the CEbroker course is created, work through the operational
            steps below in the CE Events tab. Save the event to start tracking
            attendees.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {CE_PLANNING_CHECKLIST.map((section) => (
              <div key={section.group}>
                <p className="text-xs font-semibold text-slate-700">
                  {section.group}
                </p>
                <ul className="mt-1 space-y-1">
                  {section.items.map((item) => (
                    <li
                      key={item.key}
                      className="flex items-start gap-2 text-xs text-slate-600"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-emerald-400" />
                      {item.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {result?.ok === false && (
        <p className="mt-3 text-sm text-red-600">{result.error}</p>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
        <div className="flex items-center gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Back
            </button>
          )}
          {!isLast && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              Next
            </button>
          )}
          {isLast && (
            <SaveButton label={isEdit ? "Save event" : "Create event"} />
          )}
        </div>
      </div>
    </form>
  );
}
