"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
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
  Callout,
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
  CE_RACE_CATEGORY_OPTIONS,
  CE_RACE_INTERACTIVITY_OPTIONS,
  CE_RACE_COURSE_FORMAT_OPTIONS,
  CE_RACE_REJECTION_REASONS,
  CE_PLANNING_CHECKLIST,
  type CrmCeEvent,
} from "@/lib/crm/types";

// Wizard steps mirror the GDD CE workflow AND the AAVSB RACE Standards program
// application: build the CEbroker course record + RACE category, capture the
// RACE approval details & credits, document presenters to RACE's SME standard,
// then publish with RACE-compliant advertising and a readiness check so the
// event only ever needs to be built once.
const STEPS = [
  {
    title: "Course basics",
    blurb: "The core course record + RACE program category.",
  },
  {
    title: "RACE approval & credits",
    blurb: "AAVSB / RACE submission details, delivery method and CE hours.",
  },
  {
    title: "Presenters & logistics",
    blurb: "Who's teaching (to RACE's SME standard) and how the event runs.",
  },
  {
    title: "Publish & next steps",
    blurb: "RACE readiness check, advertising language and setup checklist.",
  },
] as const;

// RACE Standards Article IV: one full CE credit per 50–60 minutes of actual
// instruction (excluding quiz time); nothing under 0.25 credit is accepted.
// Returns credits floored to the nearest 0.25 using the 50-minute basis.
function creditsFromMinutes(minutes: number): number {
  if (!minutes || minutes <= 0) return 0;
  return Math.floor((minutes / 50) * 4) / 4;
}

function toNum(value: string): number | null {
  const n = Number(value);
  return value.trim() === "" || Number.isNaN(n) ? null : n;
}

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

  // RACE-relevant fields mirrored into state so we can drive live warnings, the
  // readiness check and the advertising-language generator. Inputs stay
  // uncontrolled (defaultValue) so they still submit normally — onChange only
  // mirrors the value here.
  const [name, setName] = useState(event?.name ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [objectives, setObjectives] = useState(
    event?.learning_objectives ?? "",
  );
  const [disclosure, setDisclosure] = useState(
    event?.disclosure_statements ?? "",
  );
  const [category, setCategory] = useState(event?.race_program_category ?? "");
  const [interactivity, setInteractivity] = useState(
    event?.race_interactivity ?? "",
  );
  const [courseFormat, setCourseFormat] = useState(
    event?.race_course_format ?? "",
  );
  const [hoursTotal, setHoursTotal] = useState<number | null>(
    event?.ce_hours_total ?? null,
  );
  const [hoursMedical, setHoursMedical] = useState<number | null>(
    event?.ce_hours_medical ?? null,
  );
  const [hoursNonmedical, setHoursNonmedical] = useState<number | null>(
    event?.ce_hours_nonmedical ?? null,
  );
  const [presenters, setPresenters] = useState(event?.presenters ?? "");
  const [presenterQuals, setPresenterQuals] = useState(
    event?.presenter_qualifications ?? "",
  );
  const [presenterCv, setPresenterCv] = useState(event?.presenter_cv_url ?? "");
  const [hasCoi, setHasCoi] = useState(event?.has_conflict_of_interest ?? false);
  const [postTestQ, setPostTestQ] = useState<number | null>(
    event?.post_test_questions ?? null,
  );
  const [approvalStatus, setApprovalStatus] = useState(
    event?.approval_status ?? "not_submitted",
  );
  const [raceApproved, setRaceApproved] = useState(event?.race_approved ?? false);

  useEffect(() => {
    if (result?.ok) onDone();
  }, [result, onDone]);

  const isLast = step === STEPS.length - 1;
  const isConference = courseFormat === "conference";
  const requiredPostTest =
    interactivity === "noninteractive" && hoursTotal != null
      ? Math.max(5, Math.ceil(hoursTotal * 5))
      : 0;

  // RACE program-application readiness. Each item maps to a RACE Standards
  // requirement so coordinators can submit correctly the first time.
  const readiness = useMemo(() => {
    const items: { label: string; ok: boolean }[] = [
      { label: "Program title", ok: name.trim().length > 0 },
      { label: "Program description", ok: description.trim().length > 0 },
      { label: "Learning objectives", ok: objectives.trim().length > 0 },
      { label: "Program category (medical / non-medical)", ok: !!category },
      {
        label: "Delivery method (interactive vs non-interactive)",
        ok: !!interactivity,
      },
      {
        label: "Course format (single / conference / series)",
        ok: !!courseFormat,
      },
      {
        label: "CE credit request (≥ 0.25)",
        ok: hoursTotal != null && hoursTotal >= 0.25,
      },
      { label: "Presenter name(s)", ok: presenters.trim().length > 0 },
      {
        label: "Presenter SME qualifications",
        ok: presenterQuals.trim().length > 0,
      },
      {
        label: "Presenter CV / RACE template link",
        ok: presenterCv.trim().length > 0,
      },
    ];
    if (category === "both") {
      const sum = (hoursMedical ?? 0) + (hoursNonmedical ?? 0);
      items.push({
        label: "Medical + non-medical hours match total",
        ok: hoursTotal != null && Math.abs(sum - hoursTotal) < 0.001,
      });
    }
    if (hasCoi) {
      items.push({
        label: "Conflict-of-interest disclosure statement",
        ok: disclosure.trim().length > 0,
      });
    }
    if (interactivity === "noninteractive") {
      items.push({
        label: `Post-course test (≥ ${requiredPostTest} questions, 70% pass)`,
        ok: postTestQ != null && postTestQ >= requiredPostTest,
      });
    }
    return items;
  }, [
    name,
    description,
    objectives,
    category,
    interactivity,
    courseFormat,
    hoursTotal,
    hoursMedical,
    hoursNonmedical,
    presenters,
    presenterQuals,
    presenterCv,
    hasCoi,
    disclosure,
    postTestQ,
    requiredPostTest,
  ]);

  const readyCount = readiness.filter((r) => r.ok).length;
  const allReady = readyCount === readiness.length;

  // RACE Standards Sec 7.05 advertising language (approved vs pending), with the
  // conference variant that also states per-attendee hours.
  const advertising = useMemo(() => {
    const hrs = hoursTotal != null ? hoursTotal : "_____";
    if (raceApproved || approvalStatus === "approved") {
      if (isConference) {
        return `This program has been RACE approved for ${hrs} hours of continuing education credit in jurisdictions that recognize RACE approval, with _____ hours available to an individual attendee.`;
      }
      return `This program has been RACE approved for ${hrs} hours of continuing education credit in jurisdictions that recognize RACE approval.`;
    }
    return `This program has been submitted for RACE approval (but is not yet approved) for ${hrs} hours of continuing education credit in jurisdictions which recognize RACE approval.`;
  }, [raceApproved, approvalStatus, isConference, hoursTotal]);

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
        <Callout tone="info" title="Build it once for RACE" className="mb-4">
          Fill in the fields below to AAVSB RACE Standards. Look for the{" "}
          <span className="font-semibold">ⓘ</span> hints on each field — they
          explain exactly what RACE expects so the application is approved the
          first time.
        </Callout>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <Field
              label="Course title"
              name="name"
              defaultValue={event?.name}
              onChange={setName}
              hint="RACE Sec 7.03 — the Program Title on the RACE Course Attachment page. Be specific; it must match what is advertised and on the certificate."
            />
          </div>
          <ComboField
            label="Subject area"
            name="subject"
            defaultValue={event?.subject}
            options={CE_SUBJECT_SUGGESTIONS as unknown as string[]}
            placeholder="e.g. Ultrasound / Imaging"
            hint="The clinical or professional topic. Content must raise the knowledge of an already-graduated veterinary professional (RACE Sec 3)."
          />
          <Select
            label="RACE program category"
            name="race_program_category"
            defaultValue={event?.race_program_category}
            options={CE_RACE_CATEGORY_OPTIONS}
            onChange={setCategory}
            hint="RACE Sec 3. Medical = clinical/scientific/One-Health topics. Non-medical = practice management, communication, jurisprudence, wellness. Use 'Both' only for multi-session programs mixing the two."
          />
          <Select
            label="RACE course format"
            name="race_course_format"
            defaultValue={event?.race_course_format}
            options={CE_RACE_COURSE_FORMAT_OPTIONS}
            onChange={setCourseFormat}
            hint="RACE Sec 7. Single = one offering, credit on completion. Conference = concurrent sessions, credit per session (multi-session roster). Series/Modular = linked courses, credit only after ALL are completed."
          />
          <Select
            label="Course type (CEbroker)"
            name="course_type"
            defaultValue={event?.course_type}
            options={CE_COURSE_TYPE_OPTIONS}
            hint="How the course is recorded in CEbroker (providers.cebroker.com). This is the CEbroker field, separate from the RACE course format above."
          />
          <Select
            label="Delivery method (CEbroker)"
            name="delivery_method"
            defaultValue={event?.delivery_method}
            options={CE_DELIVERY_METHOD_OPTIONS}
            hint="The CEbroker delivery method — e.g. Seminar/Lecture, Lab/Wet Lab, Online. Should match how the program is actually run."
          />
          <TextArea
            label="Description"
            name="description"
            defaultValue={event?.description}
            onChange={setDescription}
            hint="RACE Sec 7.03 Program Description. Summarize the content and who it's for. RACE will reject programs that are primarily marketing, Q&A only, exhibit-hall/poster only, or panels without written objectives (Sec 6)."
          />
          <TextArea
            label="Learning objectives"
            name="learning_objectives"
            defaultValue={event?.learning_objectives}
            onChange={setObjectives}
            hint="RACE Sec 7.03 — specify the information, skills and concepts presented and what the attendee is expected to learn. Use measurable, action-oriented statements."
          />
          <TextArea
            label="Disclosure statements"
            name="disclosure_statements"
            defaultValue={event?.disclosure_statements}
            onChange={setDisclosure}
            hint="RACE Sec 6. Required if the program references a product/service/company or the presenter has a commercial relationship. Disclose relationships among provider, presenter and content in an intro slide or verbal acknowledgment."
          />
        </div>
      </div>

      {/* Step 2 — RACE approval & credits */}
      <div hidden={step !== 1}>
        <Callout
          tone="warn"
          title="Do not advertise as approved yet"
          className="mb-4"
        >
          RACE Sec 7.05 — you may not advertise a program as RACE approved until
          you receive official approval. Until then, use the “submitted for RACE
          approval (but not yet approved)” language shown on the last step.
        </Callout>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="RACE delivery (interactivity)"
            name="race_interactivity"
            defaultValue={event?.race_interactivity}
            options={CE_RACE_INTERACTIVITY_OPTIONS}
            onChange={setInteractivity}
            hint="RACE Sec 5. Interactive = attendees can interact with the presenter (in-person or live remote). Non-interactive = on-demand/recorded/home study, which REQUIRES a post-course test."
          />
          <Field
            label="Tracking number (CEbroker)"
            name="tracking_number"
            defaultValue={event?.tracking_number}
            hint="The RACE program tracking number (starts with 20-) assigned on submission. Goes on the certificate and roster upload."
          />
          <ComboField
            label="Approval board"
            name="approval_board"
            defaultValue={event?.approval_board}
            options={CE_APPROVAL_BOARD_SUGGESTIONS as unknown as string[]}
            placeholder="e.g. AAVSB / RACE"
            hint="The board reviewing the program. RACE is the AAVSB program recognized across jurisdictions."
          />
          <Select
            label="Approval status"
            name="approval_status"
            defaultValue={event?.approval_status ?? "not_submitted"}
            options={CE_APPROVAL_STATUS_OPTIONS}
            onChange={setApprovalStatus}
            hint="Where the application sits in the RACE pipeline. Advertising language and the certificate depend on this being 'Approved'."
          />
          <Field
            label="Total CE hours"
            name="ce_hours_total"
            type="number"
            defaultValue={event?.ce_hours_total}
            onChange={(v) => setHoursTotal(toNum(v))}
            hint="RACE Article IV — 1 credit per 50–60 min of actual instruction (quiz time excluded). Minimum 0.25 credit. Use the calculator below to convert minutes."
          />
          <Field
            label="Medical CE hours"
            name="ce_hours_medical"
            type="number"
            defaultValue={event?.ce_hours_medical}
            onChange={(v) => setHoursMedical(toNum(v))}
            hint="Portion of total hours that is Medical (RACE Sec 3). Required on the roster for multi-session programs."
          />
          <Field
            label="Non-medical CE hours"
            name="ce_hours_nonmedical"
            type="number"
            defaultValue={event?.ce_hours_nonmedical}
            onChange={(v) => setHoursNonmedical(toNum(v))}
            hint="Portion of total hours that is Non-medical (practice mgmt / wellness / professional development)."
          />
          {interactivity === "noninteractive" && (
            <Field
              label="Post-course test questions"
              name="post_test_questions"
              type="number"
              defaultValue={event?.post_test_questions}
              onChange={(v) => setPostTestQ(toNum(v))}
              hint="RACE Sec 5.02 — non-interactive programs need at least 5 questions per CE credit; credit is only awarded at 70% or higher."
            />
          )}
          <div className="flex items-end pb-2">
            <Checkbox
              label="RACE approved"
              name="race_approved"
              defaultChecked={event?.race_approved}
              onChange={setRaceApproved}
              hint="Check only once official RACE approval is received. Enables approved certificate & advertising language."
            />
          </div>
        </div>

        <CreditCalculator />

        {hoursTotal != null && hoursTotal > 0 && hoursTotal < 0.25 && (
          <Callout tone="warn" className="mt-3">
            RACE will not accept programs under <strong>0.25 CE credits</strong>{" "}
            (Article IV). Increase instructional time or credit request.
          </Callout>
        )}
        {category === "both" &&
          hoursTotal != null &&
          Math.abs((hoursMedical ?? 0) + (hoursNonmedical ?? 0) - hoursTotal) >
            0.001 && (
            <Callout tone="warn" className="mt-3">
              Medical ({hoursMedical ?? 0}) + non-medical ({hoursNonmedical ?? 0}
              ) hours should add up to the total ({hoursTotal}).
            </Callout>
          )}
        {interactivity === "noninteractive" && (
          <Callout tone="info" className="mt-3">
            Non-interactive program: prepare a post-course test with at least{" "}
            <strong>{requiredPostTest || 5}</strong> questions (5 per credit),
            passing at 70%+ (RACE Sec 5.02).
          </Callout>
        )}
      </div>

      {/* Step 3 — Presenters & logistics */}
      <div hidden={step !== 2}>
        <Callout
          tone="info"
          title="Presenters must be subject-matter experts"
          className="mb-4"
        >
          RACE Sec 7.04 requires a CV / resume / RACE template page for{" "}
          <em>every</em> presenter, proving expertise above the audience level.
          {category === "medical" || category === "both" ? (
            <>
              {" "}
              Medical: board certification, VTS, advanced degree, or recent
              peer-reviewed publications.
            </>
          ) : null}
          {category === "nonmedical" ? (
            <>
              {" "}
              Non-medical: relevant academic degree or extensive experience in
              the subject.
            </>
          ) : null}{" "}
          Presenters not meeting these need two letters of recommendation.
        </Callout>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Presenter(s)"
            name="presenters"
            defaultValue={event?.presenters}
            onChange={setPresenters}
            hint="Full name(s) and credentials of every presenter. Each presenter is submitted separately to RACE."
          />
          <Field
            label="Presenter CV / RACE template link"
            name="presenter_cv_url"
            defaultValue={event?.presenter_cv_url}
            onChange={setPresenterCv}
            hint="RACE Sec 7.04 — link to each presenter's CV, resume, or the AAVSB RACE template page. Required for every presenter on the application."
          />
          <Field
            label="Public website / info URL"
            name="website_url"
            defaultValue={event?.website_url}
            hint="Public event/landing page. Must not claim RACE approval before it is granted (Sec 7.05)."
          />
          <Field
            label="Registration link"
            name="registration_url"
            defaultValue={event?.registration_url}
            hint="Where attendees register. Collect one license number and jurisdiction per attendee at registration for the RACE roster upload."
          />
          <TextArea
            label="Presenter qualifications (RACE SME)"
            name="presenter_qualifications"
            defaultValue={event?.presenter_qualifications}
            onChange={setPresenterQuals}
            hint="RACE Sec 7.04 — how each presenter qualifies as a subject-matter expert: board certification, VTS, advanced degree, publications (last 10 yrs), or extensive experience. Note any letters of recommendation."
          />
          <TextArea
            label="Presenter bio"
            name="presenter_bio"
            defaultValue={event?.presenter_bio}
            hint="Public-facing biography for marketing. Distinct from the RACE SME qualifications above."
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
              label="Product/service program (conflict of interest)"
              name="has_conflict_of_interest"
              defaultChecked={event?.has_conflict_of_interest}
              onChange={setHasCoi}
              hint="RACE Sec 6. Check if the program educates about a product/service/company or a presenter has a commercial relationship. A disclosure statement is then required and it must not be primarily marketing."
            />
          </div>
          <div className="flex items-end pb-2">
            <Checkbox
              label="ADA / accessibility compliant"
              name="ada_acknowledged"
              defaultChecked={event?.ada_acknowledged}
              hint="RACE Sec 5.03 — acknowledge the program complies with the ADA and applicable disabilities laws so all attendees can access the content."
            />
          </div>
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
        {hasCoi && disclosure.trim().length === 0 && (
          <Callout tone="warn" className="mt-3">
            This is a product/service program — add a{" "}
            <strong>disclosure statement</strong> on Step 1 and present it as an
            intro slide or verbal acknowledgment (RACE Sec 6).
          </Callout>
        )}
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

        {/* RACE readiness */}
        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              RACE submission readiness
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                allReady
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {readyCount}/{readiness.length} ready
            </span>
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {readiness.map((r) => (
              <li
                key={r.label}
                className={`flex items-start gap-2 text-xs ${
                  r.ok ? "text-slate-600" : "text-amber-700"
                }`}
              >
                <span className="mt-0.5 flex-none font-semibold">
                  {r.ok ? "✓" : "○"}
                </span>
                {r.label}
              </li>
            ))}
          </ul>
          {!allReady && (
            <p className="mt-2 text-xs text-amber-700">
              You can still save now — finish the open items before submitting to
              RACE. Add the program agenda (session name, length, presenter, CE
              request) in the CE Events tab itinerary.
            </p>
          )}
        </div>

        {/* Advertising language */}
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            RACE-compliant advertising language (Sec 7.05)
          </p>
          <p className="mt-2 rounded-md bg-slate-50 p-3 text-xs italic text-slate-700">
            “{advertising}”
          </p>
          <CopyButton text={advertising} />
        </div>

        {/* Programs RACE will not accept */}
        <div className="mt-4">
          <Callout
            tone="warn"
            title="Before you submit — RACE will NOT accept programs that:"
          >
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {CE_RACE_REJECTION_REASONS.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Callout>
        </div>

        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Remaining setup checklist
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Once the CEbroker course is created, work through the operational
            steps below in the CE Events tab. Save the event to start tracking
            attendees. Remember: upload the RACE roster within 30 days of the
            program (late fees apply after 60/90 days) and keep records 4 years.
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

// Self-contained helper: convert minutes of actual instruction into RACE CE
// credits (RACE Article IV). Purely informational — does not submit a value.
function CreditCalculator() {
  const [minutes, setMinutes] = useState("");
  const mins = Number(minutes);
  const credits = creditsFromMinutes(mins);
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        CE credit calculator
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Minutes of instruction (excl. quiz)
          <input
            type="number"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="w-24 rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <span className="text-sm text-slate-600">
          ≈{" "}
          <strong className="text-emerald-700">
            {mins > 0 ? credits.toFixed(2) : "—"}
          </strong>{" "}
          CE credits
        </span>
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        1 credit per 50–60 min of actual instruction; rounded down to 0.25.
        {mins > 0 && credits < 0.25
          ? " Below the 0.25 minimum RACE will accept."
          : ""}
      </p>
    </div>
  );
}

// Copy-to-clipboard for the generated advertising language.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard unavailable — no-op.
        }
      }}
      className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
    >
      {copied ? "Copied ✓" : "Copy language"}
    </button>
  );
}
