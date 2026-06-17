"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type CrmOrganization,
  type CrmContact,
  type CrmInfluencer,
  ORG_TYPE_LABELS,
} from "@/lib/crm/types";

function contactName(c: CrmContact): string {
  if (c.full_name) return c.full_name;
  const parts = [c.first_name, c.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

function compactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
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
// Generic, reusable CRM table: standard Search + Filters + Sortable columns.
// Every sub-CRM uses this so the experience is identical across the module.
// ---------------------------------------------------------------------------
type CellValue = string | number | boolean | null | undefined;

interface Column<T> {
  key: string;
  header: string;
  /** Raw value used for sorting AND global search. */
  value: (row: T) => CellValue;
  /** Optional custom cell renderer (defaults to the stringified value). */
  render?: (row: T) => React.ReactNode;
  /** Defaults to true. Set false to disable header-click sorting. */
  sortable?: boolean;
  className?: string;
}

interface FilterDef<T> {
  key: string;
  label: string;
  /** Returns the filter value for a row (null/empty => excluded from options). */
  value: (row: T) => string | null | undefined;
}

type SortDir = "asc" | "desc";

function SortIcon({ dir }: { dir: SortDir | null }) {
  return (
    <span className="ml-1 inline-flex w-3 flex-col text-[9px] leading-[7px]">
      <span className={dir === "asc" ? "text-emerald-600" : "text-slate-300"}>
        ▲
      </span>
      <span className={dir === "desc" ? "text-emerald-600" : "text-slate-300"}>
        ▼
      </span>
    </span>
  );
}

function cellText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function compareValues(a: CellValue, b: CellValue): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // empties always sort last
  if (bEmpty) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return cellText(a).localeCompare(cellText(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function CrmDataTable<T extends { id: string }>({
  rows,
  columns,
  filters = [],
  searchExtra,
  searchPlaceholder = "Search…",
  onRowClick,
  emptyLabel = "No records match your search.",
}: {
  rows: T[];
  columns: Column<T>[];
  filters?: FilterDef<T>[];
  /** Extra hidden text included in the global search (e.g. email, notes). */
  searchExtra?: (row: T) => CellValue[];
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [active, setActive] = useState<Record<string, string>>({});

  // Build filter dropdowns: only keep filters that have 2+ distinct values.
  const filterOptions = useMemo(() => {
    return filters
      .map((f) => {
        const seen = new Map<string, number>();
        for (const r of rows) {
          const v = f.value(r);
          if (v === null || v === undefined || v === "") continue;
          seen.set(v, (seen.get(v) ?? 0) + 1);
        }
        const options = [...seen.entries()]
          .sort((a, b) =>
            a[0].localeCompare(b[0], undefined, { numeric: true }),
          )
          .map(([value, count]) => ({ value, count }));
        return { def: f, options };
      })
      .filter((f) => f.options.length > 1);
  }, [filters, rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      for (const f of filters) {
        const sel = active[f.key];
        if (sel && sel !== "all" && (f.value(r) ?? "") !== sel) return false;
      }
      if (!q) return true;
      const haystack = [
        ...columns.map((c) => c.value(r)),
        ...(searchExtra ? searchExtra(r) : []),
      ]
        .map(cellText)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, columns, filters, active, query, searchExtra]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort(
      (a, b) => compareValues(col.value(a), col.value(b)) * dir,
    );
  }, [filtered, columns, sortKey, sortDir]);

  function toggleSort(col: Column<T>) {
    if (col.sortable === false) return;
    if (sortKey !== col.key) {
      setSortKey(col.key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir("asc");
    }
  }

  const hasActiveFilters =
    Object.values(active).some((v) => v && v !== "all") || query.trim() !== "";

  return (
    <>
      {/* Toolbar: prominent search + adaptive filter dropdowns */}
      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white/70 p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:min-w-64">
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          >
            🔍
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {filterOptions.map(({ def, options }) => (
          <div key={def.key} className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-slate-500">
              {def.label}
            </label>
            <select
              value={active[def.key] ?? "all"}
              onChange={(e) =>
                setActive((s) => ({ ...s, [def.key]: e.target.value }))
              }
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All ({rows.length})</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value} ({o.count})
                </option>
              ))}
            </select>
          </div>
        ))}

        {hasActiveFilters && (
          <button
            onClick={() => {
              setQuery("");
              setActive({});
            }}
            className="rounded-lg px-2.5 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            Clear
          </button>
        )}

        <span className="text-xs text-slate-400 sm:ml-auto">
          {sorted.length} of {rows.length}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((col) => {
                const isSorted = sortKey === col.key;
                const sortable = col.sortable !== false;
                return (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col)}
                    className={`px-4 py-3 ${
                      sortable
                        ? "cursor-pointer select-none hover:text-slate-700"
                        : ""
                    } ${col.className ?? ""}`}
                  >
                    <span className="inline-flex items-center">
                      {col.header}
                      {sortable && <SortIcon dir={isSorted ? sortDir : null} />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((row) => (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row)}
                className={`transition hover:bg-emerald-50 ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-2.5 text-slate-700 ${col.className ?? ""}`}
                  >
                    {col.render
                      ? col.render(row)
                      : cellText(col.value(row)) || "—"}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-slate-400"
                >
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ViewHeader({
  icon,
  title,
  description,
  count,
}: {
  icon: string;
  title: string;
  description: string;
  count: number;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <span aria-hidden>{icon}</span>
          {title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {description} · {count} records
        </p>
      </div>
    </div>
  );
}

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

  return (
    <div className="mx-auto max-w-7xl">
      <ViewHeader
        icon={icon}
        title={title}
        description={description}
        count={organizations.length}
      />
      <CrmDataTable
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
          { key: "program", header: "Program", value: (c) => c.program_name },
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
          { key: "program", label: "Program", value: (c) => c.program_name },
          { key: "school", label: "School", value: (c) => c.school },
          { key: "cohort", label: "Cohort", value: (c) => c.cohort },
        ]
      : [
          {
            key: "lead_source",
            label: "Lead Source",
            value: (c) => c.lead_source,
          },
          { key: "status", label: "Status", value: (c) => c.status },
        ];

  return (
    <div className="mx-auto max-w-7xl">
      <ViewHeader
        icon={icon}
        title={title}
        description={description}
        count={contacts.length}
      />
      <CrmDataTable
        rows={contacts}
        columns={columns}
        filters={filters}
        searchPlaceholder="Search by name, email, phone…"
        searchExtra={(c) => [
          c.phone,
          c.organization,
          c.program_name,
          c.school,
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

function Pill({ text, styles }: { text: string; styles: Record<string, string> }) {
  const key = text.toLowerCase();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
        styles[key] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {text}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/80 p-4 text-center shadow-sm">
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-500">{label}</p>
    </div>
  );
}

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
  const tierCounts = influencers.reduce<Record<string, number>>((acc, i) => {
    if (i.tier) acc[i.tier] = (acc[i.tier] ?? 0) + 1;
    return acc;
  }, {});

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
      <ViewHeader
        icon="⭐"
        title="Influencer CRM"
        description="Influencer partnerships, campaigns & performance"
        count={total}
      />

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total" value={String(total)} />
        <StatCard label="Active Partners" value={String(active)} />
        <StatCard label="Prospects" value={String(prospects)} />
        <StatCard label="Needs Follow-up" value={String(followUp)} />
        <StatCard label="Total Reach" value={compactNumber(totalReach)} />
      </div>

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

      <CrmDataTable
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
