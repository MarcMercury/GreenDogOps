"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  type CrmOrganization,
  type CrmContact,
  type CrmInfluencer,
  type ContactType,
  ORG_TYPE_LABELS,
  subtypeLabel,
  categoryLabel,
  RECOMMENDATION_LEVEL_OPTIONS,
} from "@/lib/crm/types";
import { logOrgQuickNote, importContacts, type ImportContactRow } from "./actions";
import {
  type Stat,
  type Column,
  type FilterDef,
  StatGrid,
  DataTable,
  ModuleHeader,
  Pill,
  compactNumber,
  compactCurrency,
  exportColumnsCsv,
  previewCsvImport,
  readCsvAsObjects,
} from "../_components/data-views";
import { opportunityShortLabel } from "@/lib/shared/opportunity-types";

// Pill background colors for a student's recommendation level.
const RECOMMENDATION_PILL_STYLES: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-700",
  yellow: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
};

function recommendationLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return (
    RECOMMENDATION_LEVEL_OPTIONS.find((o) => o.value === value)?.label ?? value
  );
}

function contactName(c: CrmContact): string {
  if (c.full_name) return c.full_name;
  const parts = [c.first_name, c.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

function influencerReach(i: CrmInfluencer): number {
  return (
    i.follower_count ??
    (i.instagram_followers ?? 0) +
      (i.tiktok_followers ?? 0) +
      (i.youtube_subscribers ?? 0) +
      (i.facebook_followers ?? 0)
  );
}

// ---------------------------------------------------------------------------
// Organizations (Referral landing list, Vendor, Business CRMs)
// ---------------------------------------------------------------------------
export function OrgListView({
  organizations,
  title,
  description,
  icon,
  addHref,
  financial = true,
  enableQuickNote = false,
}: {
  organizations: CrmOrganization[];
  title: string;
  description: string;
  icon: string;
  addHref?: string;
  financial?: boolean;
  enableQuickNote?: boolean;
}) {
  const router = useRouter();
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);

  const columns: Column<CrmOrganization>[] = [
    {
      key: "name",
      header: "Name",
      value: (o) => o.name,
      render: (o) => (
        <span className="font-medium text-slate-900">
          {o.name}
          {o.is_preferred && <span className="ml-1.5 text-amber-500">★</span>}
        </span>
      ),
    },
    {
      key: "category",
      header: "Category",
      value: (o) => categoryLabel(o.category),
    },
    {
      key: "type",
      header: "Type",
      value: (o) => (o.subtype ? subtypeLabel(o.subtype) : ORG_TYPE_LABELS[o.org_type]),
    },
    { key: "contact", header: "Contact", value: (o) => o.contact_name },
    { key: "phone", header: "Phone", value: (o) => o.phone, sortable: false },
    { key: "area", header: "Area", value: (o) => o.area },
  ];

  // Core defining filters for organizations — auto-hidden when not meaningful.
  const filters: FilterDef<CrmOrganization>[] = [
    { key: "category", label: "Category", value: (o) => categoryLabel(o.category), multi: true },
    { key: "type", label: "Type", value: (o) => (o.subtype ? subtypeLabel(o.subtype) : ORG_TYPE_LABELS[o.org_type]), multi: true },
    { key: "area", label: "Area", value: (o) => o.area, multi: true },
  ];

  const stats: Stat[] = useMemo(() => {
    const isActive = (o: CrmOrganization) =>
      o.is_active || (o.status ?? "").toLowerCase() === "active";
    const base: Stat[] = [
      { label: "Total", value: String(organizations.length), tone: "text-emerald-700" },
      { label: "Active", value: String(organizations.filter(isActive).length), tone: "text-emerald-600" },
      { label: "Preferred", value: String(organizations.filter((o) => o.is_preferred).length), tone: "text-amber-600" },
    ];
    if (financial) {
      base.push(
        { label: "Total Referrals", value: organizations.reduce((s, o) => s + (o.total_referrals ?? 0), 0).toLocaleString(), tone: "text-sky-700" },
        { label: "Total Revenue", value: compactCurrency(organizations.reduce((s, o) => s + (Number(o.revenue) || 0), 0)), tone: "text-indigo-700" },
      );
    }
    base.push({ label: "Monthly Spend", value: compactCurrency(organizations.reduce((s, o) => s + (Number(o.monthly_spend) || 0), 0)), tone: "text-violet-700" });
    return base;
  }, [organizations, financial]);

  return (
    <div className="mx-auto max-w-7xl">
      <ModuleHeader
        icon={icon}
        eyebrow="CRM"
        title={title}
        description={description}
        count={organizations.length}
        addHref={addHref}
        onExport={() =>
          exportColumnsCsv(title.toLowerCase().replace(/\s+/g, "-"), columns, organizations)
        }
        onImport={(f) => previewCsvImport(f, "organization")}
        actions={
          enableQuickNote ? (
            <button
              onClick={() => setQuickNoteOpen(true)}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              📝 Quick Note
            </button>
          ) : undefined
        }
      />
      <StatGrid stats={stats} />
      <DataTable
        rows={organizations}
        columns={columns}
        filters={filters}
        searchPlaceholder="Search by name, contact, email, area…"
        searchExtra={(o) => [o.email, o.services, o.city, o.account_rep]}
        onRowClick={(o) => router.push(`/crm/org/${o.id}`)}
      />
      {quickNoteOpen && (
        <QuickNoteDialog
          organizations={organizations}
          onClose={() => setQuickNoteOpen(false)}
          onSaved={() => {
            setQuickNoteOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Note dialog — appends a timestamped note to an account's Notes tab
// and stamps its Last Visited date.
// ---------------------------------------------------------------------------
function QuickNoteDialog({
  organizations,
  onClose,
  onSaved,
}: {
  organizations: CrmOrganization[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...organizations].sort((a, b) => a.name.localeCompare(b.name)),
    [organizations],
  );

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await logOrgQuickNote(null, formData);
      if (r.ok) onSaved();
      else setError(r.error);
    });
  }

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
  const label = "text-xs font-medium text-slate-500";

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form action={submit}>
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-lg font-bold text-slate-900">Quick Note</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Adds a date-stamped note and updates Last Visited.
            </p>
          </div>
          <div className="space-y-4 p-5">
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className={label}>Account</span>
                <select
                  name="org_id"
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  className={input}
                >
                  <option value="">— Select account —</option>
                  {sorted.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>Visit Date</span>
                <input
                  name="visit_date"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className={input}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className={label}>Note</span>
              <textarea
                name="note"
                rows={4}
                className={input}
                placeholder="What happened on this visit or call?"
              />
            </label>
          </div>
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save Note"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contacts (Student, CE Leads CRMs)
// ---------------------------------------------------------------------------

/**
 * Map a CSV row (keyed by lower-cased header) onto an importable contact,
 * tolerating the common header variations we see in uploaded lists.
 */
function csvRowToContact(row: Record<string, string>): ImportContactRow {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = row[k];
      if (v != null && v.trim() !== "") return v.trim();
    }
    return null;
  };

  const first = pick("first name", "first_name", "firstname");
  const last = pick("last name", "last_name", "lastname");
  const full = pick("name", "full name", "full_name", "contact name", "contact");

  let firstName = first;
  let lastName = last;
  // If only a single "Name" column was provided, split it into first/last.
  if (!firstName && !lastName && full) {
    const parts = full.split(/\s+/);
    firstName = parts[0] ?? null;
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  }

  return {
    first_name: firstName,
    last_name: lastName,
    full_name: full ?? [first, last].filter(Boolean).join(" ") || null,
    email: pick("email", "contact email", "e-mail", "email address"),
    phone: pick("phone", "phone number", "mobile", "cell", "telephone"),
    organization: pick("organization", "org", "clinic", "company", "practice"),
    status: pick("status"),
    lead_source: pick("lead source", "lead_source", "source"),
    ce_events_attended: pick(
      "ce events",
      "ce event",
      "ce_events_attended",
      "events",
    ),
    notes: pick("notes", "note", "comments"),
  };
}

export function ContactListView({
  contacts,
  title,
  description,
  icon,
  variant,
  addHref,
}: {
  contacts: CrmContact[];
  title: string;
  description: string;
  icon: string;
  variant: "student" | "ce";
  addHref?: string;
}) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);

  const contactType: ContactType =
    variant === "student" ? "student" : "ce_attendee";

  async function handleImport(file: File) {
    if (importing) return;
    setImporting(true);
    try {
      const rows = await readCsvAsObjects(file);
      if (rows.length === 0) {
        window.alert(`No data rows found in “${file.name}”.`);
        return;
      }
      const mapped = rows.map(csvRowToContact);
      const result = await importContacts(contactType, mapped);
      if (!result.ok) {
        window.alert(`Import failed: ${result.error}`);
        return;
      }
      const skippedNote =
        result.skipped > 0 ? ` (${result.skipped} empty row(s) skipped)` : "";
      window.alert(
        `Imported ${result.inserted} contact${
          result.inserted === 1 ? "" : "s"
        } from “${file.name}”.${skippedNote}`,
      );
      router.refresh();
    } catch (err) {
      window.alert(
        `Could not read “${file.name}”: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setImporting(false);
    }
  }

  const columns: Column<CrmContact>[] =
    variant === "student"
      ? [
          { key: "name", header: "Name", value: contactName },
          { key: "email", header: "Email", value: (c) => c.email },
          {
            key: "school",
            header: "School / Org",
            value: (c) => c.school ?? c.organization,
          },
          { key: "program", header: "Program", value: (c) => c.program_name ?? c.program_type },
          { key: "grad_year", header: "Grad Year", value: (c) => c.grad_year },
          { key: "dvm", header: "DVM", value: (c) => c.supervising_dvm },
          {
            key: "recommendation",
            header: "Recommendation Level",
            value: (c) => recommendationLabel(c.doc_recommendation),
            render: (c) =>
              c.doc_recommendation ? (
                <Pill
                  text={recommendationLabel(c.doc_recommendation) ?? ""}
                  styles={RECOMMENDATION_PILL_STYLES}
                />
              ) : (
                <span className="text-slate-400">—</span>
              ),
          },
          { key: "status", header: "Status", value: (c) => c.status },
        ]
      : [
          { key: "name", header: "Name", value: contactName },
          { key: "email", header: "Email", value: (c) => c.email },
          {
            key: "phone",
            header: "Phone",
            value: (c) => c.phone,
            sortable: false,
          },
          {
            key: "ce_events",
            header: "CE Events",
            value: (c) => c.ce_events_attended,
          },
          {
            key: "lead_source",
            header: "Lead Source",
            value: (c) => c.lead_source,
          },
        ];

  // Core defining filters per contact CRM — auto-hidden when not meaningful.
  const filters: FilterDef<CrmContact>[] =
    variant === "student"
      ? [
          { key: "status", label: "Status", value: (c) => c.status },
          { key: "program", label: "Program", value: (c) => c.program_name ?? c.program_type },
          { key: "school", label: "School", value: (c) => c.school },
          { key: "cohort", label: "Cohort", value: (c) => c.cohort },
          { key: "grad_year", label: "Grad Year", value: (c) => c.grad_year },
          { key: "dvm", label: "DVM", value: (c) => c.supervising_dvm },
          {
            key: "doc_rec",
            label: "Recommendation",
            value: (c) => c.doc_recommendation,
          },
          {
            key: "hire_interest",
            label: "Hire Interest",
            value: (c) => c.hire_interest,
          },
          {
            key: "opportunity",
            label: "Opportunity",
            value: (c) => opportunityShortLabel(c.opportunity_type) || null,
          },
        ]
      : [
          {
            key: "lead_source",
            label: "Lead Source",
            value: (c) => c.lead_source,
          },
          { key: "status", label: "Status", value: (c) => c.status },
        ];

  const stats: Stat[] = useMemo(() => {
    const total = contacts.length;
    const active = contacts.filter((c) => (c.status ?? "").toLowerCase() === "active").length;
    const promoted = contacts.filter((c) => c.promoted_person_id).length;
    if (variant === "student") {
      const eligible = contacts.filter((c) => c.eligible_for_employment).length;
      const programs = new Set(contacts.map((c) => c.program_name).filter(Boolean)).size;
      const schools = new Set(contacts.map((c) => c.school).filter(Boolean)).size;
      return [
        { label: "Total", value: String(total), tone: "text-emerald-700" },
        { label: "Active", value: String(active), tone: "text-emerald-600" },
        { label: "Eligible", value: String(eligible), tone: "text-sky-700" },
        { label: "Promoted", value: String(promoted), tone: "text-indigo-700" },
        { label: "Programs", value: String(programs), tone: "text-amber-600" },
        { label: "Schools", value: String(schools), tone: "text-violet-700" },
      ];
    }
    const withEmail = contacts.filter((c) => c.email).length;
    const withPhone = contacts.filter((c) => c.phone).length;
    const leadSources = new Set(contacts.map((c) => c.lead_source).filter(Boolean)).size;
    return [
      { label: "Total", value: String(total), tone: "text-emerald-700" },
      { label: "Active", value: String(active), tone: "text-emerald-600" },
      { label: "With Email", value: String(withEmail), tone: "text-sky-700" },
      { label: "With Phone", value: String(withPhone), tone: "text-indigo-700" },
      { label: "Lead Sources", value: String(leadSources), tone: "text-amber-600" },
      { label: "Promoted", value: String(promoted), tone: "text-violet-700" },
    ];
  }, [contacts, variant]);

  return (
    <div className="mx-auto max-w-7xl">
      <ModuleHeader
        icon={icon}
        eyebrow="CRM"
        title={title}
        description={description}
        count={contacts.length}
        addHref={addHref}
        onExport={() =>
          exportColumnsCsv(title.toLowerCase().replace(/\s+/g, "-"), columns, contacts)
        }
        onImport={(f) => void handleImport(f)}
      />
      <StatGrid stats={stats} />
      <DataTable
        rows={contacts}
        columns={columns}
        filters={filters}
        searchPlaceholder="Search by name, email, phone…"
        searchExtra={(c) => [
          c.phone,
          c.organization,
          c.program_name,
          c.program_type,
          c.school,
          c.grad_year,
          c.supervising_dvm,
          c.lead_source,
          c.notes,
        ]}
        onRowClick={(c) => router.push(`/crm/contact/${c.id}`)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Influencer CRM — partnerships, tiers, reach & performance.
// ---------------------------------------------------------------------------
function influencerName(i: CrmInfluencer): string {
  const name = i.contact_name && i.contact_name !== "-" ? i.contact_name : null;
  if (name) return name;
  if (i.pet_name) return i.pet_name;
  if (i.instagram_handle) return `@${i.instagram_handle}`;
  return "—";
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  prospect: "bg-sky-100 text-sky-700",
  inactive: "bg-slate-100 text-slate-500",
};

const TIER_STYLES: Record<string, string> = {
  nano: "bg-slate-100 text-slate-600",
  micro: "bg-violet-100 text-violet-700",
  macro: "bg-amber-100 text-amber-700",
  mega: "bg-rose-100 text-rose-700",
};

export function InfluencerListView({
  influencers,
  addHref,
}: {
  influencers: CrmInfluencer[];
  addHref?: string;
}) {
  const router = useRouter();

  const total = influencers.length;
  const active = influencers.filter((i) => i.status === "active").length;
  const prospects = influencers.filter((i) => i.status === "prospect").length;
  const followUp = influencers.filter((i) => i.needs_followup === true).length;
  const totalReach = influencers.reduce((n, i) => n + influencerReach(i), 0);
  const totalCampaigns = influencers.reduce((n, i) => n + (i.total_campaigns ?? 0), 0);
  const tierCounts = influencers.reduce<Record<string, number>>((acc, i) => {
    if (i.tier) acc[i.tier] = (acc[i.tier] ?? 0) + 1;
    return acc;
  }, {});

  const stats: Stat[] = [
    { label: "Total", value: String(total), tone: "text-emerald-700" },
    { label: "Active Partners", value: String(active), tone: "text-emerald-600" },
    { label: "Prospects", value: String(prospects), tone: "text-sky-700" },
    { label: "Needs Follow-up", value: String(followUp), tone: "text-amber-600" },
    { label: "Total Reach", value: compactNumber(totalReach), tone: "text-indigo-700" },
    { label: "Campaigns", value: String(totalCampaigns), tone: "text-violet-700" },
  ];

  const columns: Column<CrmInfluencer>[] = [
    {
      key: "name",
      header: "Influencer",
      value: influencerName,
      render: (i) => (
        <div className="min-w-0">
          <span className="font-medium text-slate-900">{influencerName(i)}</span>
          {i.pet_name && (
            <span className="ml-1.5 text-xs text-slate-400">🐾 {i.pet_name}</span>
          )}
        </div>
      ),
    },
    {
      key: "handle",
      header: "Handle",
      value: (i) => i.instagram_handle,
      render: (i) =>
        i.instagram_handle ? (
          <span className="text-slate-600">@{i.instagram_handle}</span>
        ) : (
          "—"
        ),
    },
    {
      key: "tier",
      header: "Tier",
      value: (i) => i.tier,
      render: (i) => (i.tier ? <Pill text={i.tier} styles={TIER_STYLES} /> : "—"),
    },
    {
      key: "reach",
      header: "Reach",
      value: (i) => influencerReach(i),
      render: (i) => compactNumber(influencerReach(i)),
      className: "tabular-nums",
    },
    {
      key: "platform",
      header: "Platform",
      value: (i) => i.highest_platform,
    },
    {
      key: "status",
      header: "Status",
      value: (i) => i.status,
      render: (i) =>
        i.status ? <Pill text={i.status} styles={STATUS_STYLES} /> : "—",
    },
    {
      key: "priority",
      header: "Priority",
      value: (i) => i.priority,
    },
  ];

  const filters: FilterDef<CrmInfluencer>[] = [
    { key: "status", label: "Status", value: (i) => i.status },
    { key: "tier", label: "Tier", value: (i) => i.tier },
    { key: "platform", label: "Platform", value: (i) => i.highest_platform },
    { key: "priority", label: "Priority", value: (i) => i.priority },
    { key: "niche", label: "Niche", value: (i) => i.content_niche },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <ModuleHeader
        icon="⭐"
        eyebrow="CRM"
        title="Influencer CRM"
        description="Influencer partnerships, campaigns & performance"
        count={total}
        addHref={addHref}
        onExport={() => exportColumnsCsv("influencer-crm", columns, influencers)}
        onImport={(f) => previewCsvImport(f, "influencer")}
      />

      <StatGrid stats={stats} />

      {Object.keys(tierCounts).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {["nano", "micro", "macro", "mega"]
            .filter((t) => tierCounts[t])
            .map((t) => (
              <span
                key={t}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium capitalize ${
                  TIER_STYLES[t] ?? "bg-slate-100 text-slate-600"
                }`}
              >
                {t}
                <span className="font-bold">{tierCounts[t]}</span>
              </span>
            ))}
        </div>
      )}

      <DataTable
        rows={influencers}
        columns={columns}
        filters={filters}
        searchPlaceholder="Search by name, handle, pet, email…"
        searchExtra={(i) => [
          i.email,
          i.phone,
          i.pet_name,
          i.instagram_handle,
          i.tiktok_handle,
          i.content_niche,
          i.location,
          i.notes,
        ]}
        onRowClick={(i) => router.push(`/crm/influencer/${i.id}`)}
        emptyLabel="No influencers match your search."
      />
    </div>
  );
}
