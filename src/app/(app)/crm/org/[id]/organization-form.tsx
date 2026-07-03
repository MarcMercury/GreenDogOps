"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import {
  type CrmOrganization,
  type CrmOrgDocumentWithUrl,
  type OrgType,
  ORG_TYPE_LABELS,
  ORG_STATUS_OPTIONS,
  CRM_TIER_OPTIONS,
  CRM_PRIORITY_OPTIONS,
  ORG_SUBTYPE_SUGGESTIONS,
  CATEGORY_OPTIONS,
  AGREEMENT_STATUS_OPTIONS,
  CRM_DOCUMENT_CATEGORY_LABELS,
  subtypeLabel,
  categoryLabel,
} from "@/lib/crm/types";
import { ZONE_DEFINITIONS } from "@/lib/crm/referral-types";
import {
  updateOrganization,
  createOrganization,
  deleteOrganization,
  uploadOrgDocument,
  deleteOrgDocument,
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

type TabKey = "general" | "relationship" | "notes" | "attachments";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "general", label: "General" },
  { key: "relationship", label: "Relationship & Agreement" },
  { key: "notes", label: "Notes" },
  { key: "attachments", label: "Attachments" },
];

export function OrganizationForm({
  org,
  orgType,
  orgTypeOptions,
  locations,
  documents = [],
  canEdit = false,
  mode = "edit",
}: {
  org?: CrmOrganization | null;
  orgType?: OrgType;
  orgTypeOptions?: { value: OrgType; label: string }[];
  locations: LocationOption[];
  documents?: CrmOrgDocumentWithUrl[];
  canEdit?: boolean;
  mode?: "edit" | "create";
}) {
  const isCreate = mode === "create";
  const effectiveType: OrgType | undefined = org?.org_type ?? orgType;
  const isReferral = effectiveType === "referral_clinic";
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) =>
      isCreate
        ? createOrganization(orgType ?? "marketing_partner", prev, fd)
        : updateOrganization(org!.id, prev, fd),
    null,
  );

  // Attachments live on a saved record only.
  const tabs = isCreate ? TABS.filter((t) => t.key !== "attachments") : TABS;
  const showForm = activeTab !== "attachments";

  return (
    <div className="mt-3 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {isCreate ? "New Organization" : org!.name}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {isCreate
              ? "Complete the blank profile below, then save to add it."
              : [
                  org!.category
                    ? categoryLabel(org!.category)
                    : ORG_TYPE_LABELS[org!.org_type],
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
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition ${
              activeTab === t.key
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Field form (General / Relationship / Notes). Kept mounted so switching
          tabs never drops unsaved edits; the Attachments panel is a sibling to
          avoid nesting forms. */}
      <form action={formAction} className={`space-y-5 ${showForm ? "" : "hidden"}`}>
        <div className={activeTab === "general" ? "space-y-5" : "hidden"}>
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

          <Section title="Primary contact">
            <Field label="Contact name" name="contact_name" defaultValue={org?.contact_name} />
            <Field label="Title" name="title" defaultValue={org?.title} />
            <Field label="Phone" name="phone" defaultValue={org?.phone} />
            <Field label="Alt phone" name="phone_alt" defaultValue={org?.phone_alt} />
            <Field label="Email" name="email" type="email" defaultValue={org?.email} />
            <Field label="Website" name="website" defaultValue={org?.website} />
            <Field label="Instagram" name="instagram" defaultValue={org?.instagram} />
          </Section>

          <Section title="Secondary contact">
            <Field label="Contact name" name="secondary_contact_name" defaultValue={org?.secondary_contact_name} />
            <Field label="Title" name="secondary_contact_title" defaultValue={org?.secondary_contact_title} />
            <Field label="Phone" name="secondary_contact_phone" defaultValue={org?.secondary_contact_phone} />
            <Field label="Email" name="secondary_contact_email" type="email" defaultValue={org?.secondary_contact_email} />
          </Section>

          <Section title="Address">
            <Field label="Address" name="address" defaultValue={org?.address} />
            <Field label="City" name="city" defaultValue={org?.city} />
            <Field label="State" name="state" defaultValue={org?.state} />
            <Field label="ZIP" name="zip" defaultValue={org?.zip} />
          </Section>
        </div>

        <div className={activeTab === "relationship" ? "space-y-5" : "hidden"}>
          <Section title="Agreement">
            <Select
              label="Agreement status"
              name="agreement_status"
              defaultValue={org?.agreement_status}
              options={AGREEMENT_STATUS_OPTIONS}
            />
            <Field label="Agreement signed" name="agreement_signed_date" type="date" defaultValue={org?.agreement_signed_date} />
            <Field label="Tax ID / 501(c)(3)" name="tax_id" defaultValue={org?.tax_id} />
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
        </div>

        <div className={activeTab === "notes" ? "space-y-5" : "hidden"}>
          <Section title="Notes">
            <TextArea label="Notes" name="notes" defaultValue={org?.notes} />
          </Section>
        </div>

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

      {/* Attachments panel — sibling of the form (never nested). */}
      {!isCreate && (
        <div className={activeTab === "attachments" ? "" : "hidden"}>
          <AttachmentsPanel orgId={org!.id} documents={documents} canEdit={canEdit} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function AttachmentsPanel({
  orgId,
  documents,
  canEdit,
}: {
  orgId: string;
  documents: CrmOrgDocumentWithUrl[];
  canEdit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => uploadOrgDocument(orgId, prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <div className="space-y-5">
      {canEdit && (
        <Section title="Upload a document">
          <form ref={formRef} action={formAction} className="contents">
            <Field label="Title" name="title" />
            <Select
              label="Category"
              name="category"
              options={Object.entries(CRM_DOCUMENT_CATEGORY_LABELS).map(
                ([value, label]) => ({ value, label }),
              )}
            />
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-500">File</span>
              <input
                name="file"
                type="file"
                required
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-700 hover:file:bg-emerald-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>
            <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
              <SaveButton canEdit={canEdit} label="Upload" />
              <span className="text-xs text-slate-400">Max 25 MB.</span>
              {result?.ok === false && (
                <span className="text-sm text-red-600">{result.error}</span>
              )}
            </div>
          </form>
        </Section>
      )}

      {documents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
          No documents uploaded yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {d.signed_url ? (
                    <a
                      href={d.signed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 hover:text-emerald-900 hover:underline"
                    >
                      {d.title}
                    </a>
                  ) : (
                    d.title
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {d.category
                    ? (CRM_DOCUMENT_CATEGORY_LABELS[d.category] ?? d.category)
                    : "Uncategorized"}
                  {d.file_name ? ` · ${d.file_name}` : ""}
                  {d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ""}
                  {` · ${fmtDate(d.uploaded_at)}`}
                </p>
              </div>
              {canEdit && (
                <DeleteDocButton
                  onDelete={() => deleteOrgDocument(orgId, d.id, d.storage_path)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeleteDocButton({ onDelete }: { onDelete: () => Promise<SaveResult> }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-sm text-red-600">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Delete this document? This cannot be undone."))
            return;
          setError(null);
          startTransition(async () => {
            const r = await onDelete();
            if (r && !r.ok) setError(r.error);
          });
        }}
        className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
    </div>
  );
}
