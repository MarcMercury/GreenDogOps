"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  type CrmOrganization,
  type CrmContact,
  type CrmInfluencer,
  ORG_TYPE_LABELS,
} from "@/lib/crm/types";
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
} from "../_components/data-views";
import { OpportunityBadge } from "../_components/opportunity-type-field";
import { opportunityShortLabel } from "@/lib/shared/opportunity-types";

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
}: {
  organizations: CrmOrganization[];
  title: string;
  description: string;
  icon: string;
}) {
  const router = useRouter();

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
      key: "type",
      header: "Type",
      value: (o) => o.subtype ?? ORG_TYPE_LABELS[o.org_type],
    },
    { key: "contact", header: "Contact", value: (o) => o.contact_name },
    { key: "phone", header: "Phone", value: (o) => o.phone, sortable: false },
    { key: "area", header: "Area", value: (o) => o.area },
    { key: "status", header: "Status", value: (o) => o.status },
  ];

  // Core defining filters for organizations — auto-hidden when not meaningful.
  const filters: FilterDef<CrmOrganization>[] = [
    { key: "type", label: "Type", value: (o) => ORG_TYPE_LABELS[o.org_type] },
    { key: "status", label: "Status", value: (o) => o.status },
    { key: "area", label: "Area", value: (o) => o.area },
    { key: "tier", label: "Tier", value: (o) => o.tier },
    { key: "priority", label: "Priority", value: (o) => o.priority },
  ];

  const stats: Stat[] = useMemo(() => {
    const isActive = (o: CrmOrganization) =>
      o.is_active || (o.status ?? "").toLowerCase() === "active";
    return [
      { label: "Total", value: String(organizations.length), tone: "text-emerald-700" },
      { label: "Active", value: String(organizations.filter(isActive).length), tone: "text-emerald-600" },
      { label: "Preferred", value: String(organizations.filter((o) => o.is_preferred).length), tone: "text-amber-600" },
      { label: "Total Referrals", value: organizations.reduce((s, o) => s + (o.total_referrals ?? 0), 0).toLocaleString(), tone: "text-sky-700" },
      { label: "Total Revenue", value: compactCurrency(organizations.reduce((s, o) => s + (Number(o.revenue) || 0), 0)), tone: "text-indigo-700" },
      { label: "Monthly Spend", value: compactCurrency(organizations.reduce((s, o) => s + (Number(o.monthly_spend) || 0), 0)), tone: "text-violet-700" },
    ];
  }, [organizations]);

  return (
    <div className="mx-auto max-w-7xl">
      <ModuleHeader
        icon={icon}
        eyebrow="CRM"
        title={title}
        description={description}
        count={organizations.length}
        onExport={() =>
          exportColumnsCsv(title.toLowerCase().replace(/\s+/g, "-"), columns, organizations)
        }
        onImport={(f) => previewCsvImport(f, "organization")}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contacts (Student, CE Leads CRMs)
// ---------------------------------------------------------------------------
export function ContactListView({
  contacts,
  title,
  description,
  icon,
  variant,
}: {
  contacts: CrmContact[];
  title: string;
  description: string;
  icon: string;
  variant: "student" | "ce";
}) {
  const router = useRouter();

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
            key: "opportunity",
            header: "Opportunity",
            value: (c) => opportunityShortLabel(c.opportunity_type),
            render: (c) => <OpportunityBadge value={c.opportunity_type} />,
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
            label: "Doc Rec",
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
        onExport={() =>
          exportColumnsCsv(title.toLowerCase().replace(/\s+/g, "-"), columns, contacts)
        }
        onImport={(f) => previewCsvImport(f, "contact")}
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
}: {
  influencers: CrmInfluencer[];
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
