"use client";

import { useState, useTransition } from "react";
import {
  ReferralPartner,
  REFERRAL_TIERS,
  REFERRAL_PRIORITIES,
  CLINIC_TYPE_OPTIONS,
  CLINIC_SIZE_OPTIONS,
  ORGANIZATION_TYPE_OPTIONS,
  VET_SERVICE_OPTIONS,
  VISIT_FREQUENCY_OPTIONS,
  PREFERRED_DAY_OPTIONS,
  PREFERRED_TIME_OPTIONS,
  AGREEMENT_TYPE_OPTIONS,
  STATUS_OPTIONS,
  ZONE_DEFINITIONS,
  partnerName,
  titleCase,
} from "@/lib/crm/referral-types";
import { savePartner } from "./actions";

type FormTab = "basic" | "classification" | "visit" | "agreements" | "stats";

const TABS: { key: FormTab; label: string }[] = [
  { key: "basic", label: "Basic" },
  { key: "classification", label: "Classification" },
  { key: "visit", label: "Visit Schedule" },
  { key: "agreements", label: "Agreements" },
  { key: "stats", label: "Stats" },
];

const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const labelCls = "text-xs font-medium text-slate-500";

function Text({ label, name, defaultValue, type = "text", placeholder }: { label: string; name: string; defaultValue?: string | number | null; type?: string; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      <input name={name} type={type} defaultValue={defaultValue ?? ""} placeholder={placeholder} step={type === "number" ? "any" : undefined} className={input} />
    </label>
  );
}

function Select({ label, name, defaultValue, options, includeBlank = true, format }: { label: string; name: string; defaultValue?: string | null; options: readonly string[]; includeBlank?: boolean; format?: (v: string) => string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      <select name={name} defaultValue={defaultValue ?? ""} className={input}>
        {includeBlank && <option value="">—</option>}
        {options.map((o) => <option key={o} value={o}>{format ? format(o) : o}</option>)}
      </select>
    </label>
  );
}

function Toggle({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean | null }) {
  return (
    <label className="flex items-center gap-2 py-1">
      <input type="checkbox" name={name} defaultChecked={!!defaultChecked} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}

export function PartnerDialog({
  partner,
  onClose,
  onSaved,
}: {
  partner: ReferralPartner | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [tab, setTab] = useState<FormTab>("basic");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const p = partner;

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await savePartner(formData);
      if (r.ok) onSaved(r.message ?? "Partner saved.");
      else setError(r.error);
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <form action={submit}>
          {p && <input type="hidden" name="id" value={p.id} />}

          <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">{p ? `Edit ${partnerName(p)}` : "Add Partner"}</h2>
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-500 hover:bg-slate-50">✕</button>
            </div>
            <div className="mt-3 flex flex-nowrap gap-1 overflow-x-auto">
              {TABS.map((t) => (
                <button key={t.key} type="button" onClick={() => setTab(t.key)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === t.key ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-5">
            {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            {/* Basic */}
            <div className={tab === "basic" ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "hidden"}>
              <Text label="Partner Name *" name="name" defaultValue={p?.name ?? p?.hospital_name} />
              <Select label="Status" name="status" defaultValue={p?.status ?? "active"} options={STATUS_OPTIONS} includeBlank={false} format={titleCase} />
              <Text label="Address" name="address" defaultValue={p?.address} />
              <Text label="Phone" name="phone" defaultValue={p?.phone} />
              <Text label="Email" name="email" defaultValue={p?.email} type="email" />
              <Text label="Website" name="website" defaultValue={p?.website} />
              <Text label="Contact Name" name="contact_name" defaultValue={p?.contact_name ?? p?.contact_person} />
              <Text label="Instagram Handle" name="instagram_handle" defaultValue={p?.instagram_handle} />
              <Text label="Facebook URL" name="facebook_url" defaultValue={p?.facebook_url} />
              <Text label="LinkedIn URL" name="linkedin_url" defaultValue={p?.linkedin_url} />
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className={labelCls}>Notes</span>
                <textarea name="notes" rows={3} defaultValue={p?.notes ?? ""} className={input} />
              </label>
            </div>

            {/* Classification */}
            <div className={tab === "classification" ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "hidden"}>
              <Select label="Tier" name="tier" defaultValue={p?.tier} options={REFERRAL_TIERS} />
              <Select label="Priority" name="priority" defaultValue={p?.priority} options={REFERRAL_PRIORITIES} />
              <Select label="Zone" name="zone" defaultValue={p?.zone} options={ZONE_DEFINITIONS.map((z) => z.value)} />
              <Select label="Clinic Type" name="clinic_type" defaultValue={p?.clinic_type} options={CLINIC_TYPE_OPTIONS} format={titleCase} />
              <Select label="Size" name="size" defaultValue={p?.size} options={CLINIC_SIZE_OPTIONS} format={titleCase} />
              <Select label="Organization Type" name="organization_type" defaultValue={p?.organization_type} options={ORGANIZATION_TYPE_OPTIONS} format={titleCase} />
              <Text label="Employee Count" name="employee_count" defaultValue={p?.employee_count} />
              <Text label="Primary Contact" name="best_contact_person" defaultValue={p?.best_contact_person} />
              <div className="sm:col-span-2">
                <span className={labelCls}>Services Offered</span>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {VET_SERVICE_OPTIONS.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="services" value={s} defaultChecked={p?.services?.includes(s)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Visit schedule */}
            <div className={tab === "visit" ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "hidden"}>
              <Select label="Visit Frequency" name="visit_frequency" defaultValue={p?.visit_frequency} options={VISIT_FREQUENCY_OPTIONS} format={titleCase} />
              <Text label="Expected Days Between Visits" name="expected_visit_frequency_days" defaultValue={p?.expected_visit_frequency_days} type="number" />
              <Select label="Preferred Day" name="preferred_visit_day" defaultValue={p?.preferred_visit_day} options={PREFERRED_DAY_OPTIONS} format={titleCase} />
              <Select label="Preferred Time" name="preferred_visit_time" defaultValue={p?.preferred_visit_time} options={PREFERRED_TIME_OPTIONS} format={titleCase} />
              <Text label="Next Follow-up Date" name="next_followup_date" defaultValue={p?.next_followup_date} type="date" />
              <div className="flex items-end"><Toggle label="Needs Follow-up" name="needs_followup" defaultChecked={p?.needs_followup} /></div>
            </div>

            {/* Agreements */}
            <div className={tab === "agreements" ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "hidden"}>
              <Select label="Referral Agreement Type" name="referral_agreement_type" defaultValue={p?.referral_agreement_type} options={AGREEMENT_TYPE_OPTIONS} format={titleCase} />
              <div className="sm:col-span-2 space-y-1">
                <Toggle label="CE Event Host" name="ce_event_host" defaultChecked={p?.ce_event_host} />
                <Toggle label="Lunch & Learn Eligible" name="lunch_and_learn_eligible" defaultChecked={p?.lunch_and_learn_eligible} />
                <Toggle label="Drop-off Materials" name="drop_off_materials" defaultChecked={p?.drop_off_materials} />
              </div>
            </div>

            {/* Stats */}
            <div className={tab === "stats" ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "hidden"}>
              <Text label="Total Referrals (override)" name="total_referrals_all_time" defaultValue={p?.total_referrals_all_time} type="number" />
              <Text label="Total Revenue (override)" name="total_revenue_all_time" defaultValue={p?.total_revenue_all_time} type="number" />
              <p className="text-xs text-slate-400 sm:col-span-2">
                These are normally derived from uploaded EzyVet reports and the &ldquo;Recalculate Metrics&rdquo; action. Manual values are overwritten on the next recalculation.
              </p>
            </div>
          </div>

          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending ? "Saving…" : "Save Partner"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
