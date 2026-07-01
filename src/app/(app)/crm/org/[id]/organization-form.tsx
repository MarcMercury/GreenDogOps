"use client";

import { useActionState } from "react";
import {
  type CrmOrganization,
  type OrgType,
  ORG_TYPE_LABELS,
  ORG_STATUS_OPTIONS,
  CRM_TIER_OPTIONS,
  CRM_PRIORITY_OPTIONS,
  ORG_SUBTYPE_SUGGESTIONS,
  CATEGORY_OPTIONS,
  subtypeLabel,
  categoryLabel,
} from "@/lib/crm/types";
import { ZONE_DEFINITIONS } from "@/lib/crm/referral-types";
import {
  updateOrganization,
  createOrganization,
  deleteOrganization,
  type SaveResult,
} from "../../actions";
import {
  Field,
  TextArea,
  Checkbox,
  Select,
  ComboField,
  Section,
  SaveButton,
  DeleteButton,
} from "../../form-fields";
import {
  LocationMultiSelect,
  type LocationOption,
} from "./location-multi-select";

const ZONE_OPTIONS = ZONE_DEFINITIONS.map((z) => ({
  value: z.value,
  label: z.title,
}));

export function OrganizationForm({
  org,
  orgType,
  orgTypeOptions,
  locations,
  canEdit = false,
  mode = "edit",
}: {
  org?: CrmOrganization | null;
  orgType?: OrgType;
  orgTypeOptions?: { value: OrgType; label: string }[];
  locations: LocationOption[];
  canEdit?: boolean;
  mode?: "edit" | "create";
}) {
  const isCreate = mode === "create";
  const effectiveType: OrgType | undefined = org?.org_type ?? orgType;
  const isReferral = effectiveType === "referral_clinic";
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) =>
      isCreate
        ? createOrganization(orgType ?? "marketing_partner", prev, fd)
        : updateOrganization(org!.id, prev, fd),
    null,
  );

  return (
    <form action={formAction} className="mt-3 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {isCreate ? "New Organization" : org!.name}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {isCreate
              ? "Complete the blank profile below, then save to add it."
              : [
                  org!.category ? categoryLabel(org!.category) : ORG_TYPE_LABELS[org!.org_type],
                  org!.subtype ? subtypeLabel(org!.subtype) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          {result?.ok === true && (
            <span className="text-sm text-emerald-700">Saved ✓</span>
          )}
          {result?.ok === false && (
            <span className="text-sm text-red-600">{result.error}</span>
          )}
          <SaveButton canEdit={canEdit} label={isCreate ? "Create" : undefined} />
        </div>
      </div>

      <Section title="Overview">
        <Field label="Name" name="name" defaultValue={org?.name} />
        {isCreate && orgTypeOptions && orgTypeOptions.length > 1 && (
          <Select
            label="Record Group"
            name="org_type"
            defaultValue={orgType}
            options={orgTypeOptions}
          />
        )}
        {!isReferral && (
          <Select
            label="Category"
            name="category"
            defaultValue={org?.category}
            options={CATEGORY_OPTIONS}
          />
        )}
        <ComboField
          label="Type"
          name="subtype"
          defaultValue={org?.subtype}
          options={ORG_SUBTYPE_SUGGESTIONS}
        />
        <Select label="Status" name="status" defaultValue={org?.status} options={ORG_STATUS_OPTIONS} />
        <Select label="Business Location Zone" name="area" defaultValue={org?.area} options={ZONE_OPTIONS} />
        <LocationMultiSelect
          label="Clinic Area"
          name="clinic_area"
          locations={locations}
          defaultValue={org?.clinic_area}
        />
        <Select label="Tier" name="tier" defaultValue={org?.tier} options={CRM_TIER_OPTIONS} />
        <Select label="Priority" name="priority" defaultValue={org?.priority} options={CRM_PRIORITY_OPTIONS} />
        <Checkbox label="Preferred" name="is_preferred" defaultChecked={org?.is_preferred} />
        <Checkbox label="Active" name="is_active" defaultChecked={org?.is_active ?? true} />
      </Section>

      <Section title="Contact">
        <Field label="Contact name" name="contact_name" defaultValue={org?.contact_name} />
        <Field label="Title" name="title" defaultValue={org?.title} />
        <Field label="Phone" name="phone" defaultValue={org?.phone} />
        <Field label="Alt phone" name="phone_alt" defaultValue={org?.phone_alt} />
        <Field label="Email" name="email" type="email" defaultValue={org?.email} />
        <Field label="Website" name="website" defaultValue={org?.website} />
        <Field label="Instagram" name="instagram" defaultValue={org?.instagram} />
      </Section>

      <Section title="Address">
        <Field label="Address" name="address" defaultValue={org?.address} />
        <Field label="City" name="city" defaultValue={org?.city} />
        <Field label="State" name="state" defaultValue={org?.state} />
        <Field label="ZIP" name="zip" defaultValue={org?.zip} />
      </Section>

      <Section title="Relationship">
        <Field label="Services" name="services" defaultValue={org?.services} />
        <Field label="Membership level" name="membership_level" defaultValue={org?.membership_level} />
        <Field label="Annual fee" name="annual_fee" type="number" defaultValue={org?.annual_fee} />
        <Field label="Account number" name="account_number" defaultValue={org?.account_number} />
        <Field label="Account rep" name="account_rep" defaultValue={org?.account_rep} />
        {isReferral && (
          <>
            <Field label="Total referrals" name="total_referrals" type="number" defaultValue={org?.total_referrals} />
            <Field label="Revenue" name="revenue" type="number" defaultValue={org?.revenue} />
          </>
        )}
        <Field label="Monthly spend" name="monthly_spend" type="number" defaultValue={org?.monthly_spend} />
        <Field label="Spend YTD" name="spend_ytd" type="number" defaultValue={org?.spend_ytd} />
        <Field label="Relationship score" name="relationship_score" type="number" defaultValue={org?.relationship_score} />
        <Field label="Internal rating" name="internal_rating" type="number" defaultValue={org?.internal_rating} />
        <Field label="Last visit" name="last_visit_date" type="date" defaultValue={org?.last_visit_date} />
        <Field label="Last contact" name="last_contact_date" type="date" defaultValue={org?.last_contact_date} />
      </Section>

      <Section title="Notes">
        <TextArea label="Notes" name="notes" defaultValue={org?.notes} />
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-md sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-8 sm:pt-0">
        {canEdit && !isCreate ? (
          <DeleteButton
            recordLabel={org!.name}
            onDelete={() => deleteOrganization(org!.id)}
          />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          {result?.ok === true && (
            <span className="text-sm text-emerald-700">Saved ✓</span>
          )}
          {result?.ok === false && (
            <span className="text-sm text-red-600">{result.error}</span>
          )}
          <SaveButton canEdit={canEdit} label={isCreate ? "Create" : undefined} />
        </div>
      </div>
    </form>
  );
}
