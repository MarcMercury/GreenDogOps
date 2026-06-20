"use client";

import { useActionState } from "react";
import {
  type CrmContact,
  CONTACT_TYPE_LABELS,
  CONTACT_STATUS_OPTIONS,
  VISITOR_TYPE_OPTIONS,
  HIRE_INTEREST_OPTIONS,
  PROGRAM_TYPE_SUGGESTIONS,
} from "@/lib/crm/types";
import { updateContact, type SaveResult } from "../../actions";
import { OpportunityTypeField } from "@/app/(app)/_components/opportunity-type-field";
import {
  Field,
  TextArea,
  Checkbox,
  Select,
  ComboField,
  Section,
  SaveButton,
} from "../../form-fields";

export function ContactForm({
  contact,
  canEdit = false,
}: {
  contact: CrmContact;
  canEdit?: boolean;
}) {
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => updateContact(contact.id, prev, fd),
    null,
  );

  const heading =
    contact.full_name ||
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
    "Contact";
  const isStudent = contact.contact_type === "student";

  return (
    <form action={formAction} className="mt-3 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {heading}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {CONTACT_TYPE_LABELS[contact.contact_type]}
          </p>
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          {result?.ok === true && (
            <span className="text-sm text-emerald-700">Saved ✓</span>
          )}
          {result?.ok === false && (
            <span className="text-sm text-red-600">{result.error}</span>
          )}
          <SaveButton canEdit={canEdit} />
        </div>
      </div>

      <Section title="Personal">
        <Field label="First name" name="first_name" defaultValue={contact.first_name} />
        <Field label="Last name" name="last_name" defaultValue={contact.last_name} />
        <Field label="Email" name="email" type="email" defaultValue={contact.email} />
        <Field label="Phone" name="phone" defaultValue={contact.phone} />
        <Select label="Status" name="status" defaultValue={contact.status} options={CONTACT_STATUS_OPTIONS} />
        <Field label="School / Org" name="organization" defaultValue={contact.organization} />
      </Section>

      <Section title="Program">
        <ComboField label="Program type" name="program_type" defaultValue={contact.program_type} options={PROGRAM_TYPE_SUGGESTIONS} />
        <OpportunityTypeField defaultValue={contact.opportunity_type} />
        <Field label="Program name" name="program_name" defaultValue={contact.program_name} />
        <Field label="Cohort" name="cohort" defaultValue={contact.cohort} />
        <Field label="School" name="school" defaultValue={contact.school} />
        <Field label="Location" name="location" defaultValue={contact.location} />
        <Field label="Mentor" name="mentor" defaultValue={contact.mentor} />
        <Field label="Coordinator" name="coordinator" defaultValue={contact.coordinator} />
        {isStudent && (
          <>
            <Field label="Supervising DVM" name="supervising_dvm" defaultValue={contact.supervising_dvm} />
            <Field label="Weekday schedule" name="weekday_schedule" defaultValue={contact.weekday_schedule} />
            <Field label="Grad year" name="grad_year" defaultValue={contact.grad_year} />
          </>
        )}
        <Field label="Start date" name="start_date" type="date" defaultValue={contact.start_date} />
        <Field label="End date" name="end_date" type="date" defaultValue={contact.end_date} />
      </Section>

      {isStudent ? (
        <Section title="Internship / Hours">
          <Field label="Hours completed" name="hours_completed" type="number" defaultValue={contact.hours_completed} />
          <Field label="Hours required" name="hours_required" type="number" defaultValue={contact.hours_required} />
          <Field label="Doc recommendation" name="doc_recommendation" defaultValue={contact.doc_recommendation} />
          <Select label="Hire interest" name="hire_interest" defaultValue={contact.hire_interest} options={HIRE_INTEREST_OPTIONS} />
          <Field label="Stipend" name="stipend" defaultValue={contact.stipend} />
          <Checkbox
            label="Eligible for employment"
            name="eligible_for_employment"
            defaultChecked={contact.eligible_for_employment}
          />
          <Checkbox label="Completed" name="completed" defaultChecked={contact.completed} />
          <Checkbox label="Stipend paid" name="stipend_paid" defaultChecked={contact.stipend_paid} />
          <Checkbox label="Check cashed" name="check_cashed" defaultChecked={contact.check_cashed} />
        </Section>
      ) : (
        <Section title="CE Engagement">
          <Select label="Visitor type" name="visitor_type" defaultValue={contact.visitor_type} options={VISITOR_TYPE_OPTIONS} />
          <Field label="CE events attended" name="ce_events_attended" defaultValue={contact.ce_events_attended} />
          <Field label="Lead source" name="lead_source" defaultValue={contact.lead_source} />
        </Section>
      )}

      <Section title="Notes">
        <TextArea label="Notes" name="notes" defaultValue={contact.notes} />
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 border-t border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-md sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-8 sm:pt-0">
        {result?.ok === true && (
          <span className="text-sm text-emerald-700">Saved ✓</span>
        )}
        {result?.ok === false && (
          <span className="text-sm text-red-600">{result.error}</span>
        )}
        <SaveButton canEdit={canEdit} />
      </div>
    </form>
  );
}
