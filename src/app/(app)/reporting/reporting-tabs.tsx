"use client";

import { Fragment, useState } from "react";
import type {
  ReportOverview,
  MonthlyRow,
  LocationRow,
  LocationMonthlyRow,
  SpeciesRow,
  ProductGroupRow,
  TopProductRow,
  ProductLocationRow,
  StaffRow,
  StaffLocationRow,
  StaffBreakdown,
  ClientSummary,
  ClientsByMonthRow,
  ClientGroupRow,
  ClientRecencyRow,
  LocationKey,
} from "@/lib/reporting/types";
import { LOCATION_COLORS, SPECIES_COLORS } from "@/lib/reporting/types";
import { getStaffBreakdown } from "./actions";
import {
  StatCard,
  SectionCard,
  BarList,
  MonthlyBars,
  StackedMonthlyBars,
  fmtCurrency,
  fmtNumber,
} from "./charts";

type TabKey = "revenue" | "appointments" | "products" | "staff" | "clients";

const TABS: { key: TabKey; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "appointments", label: "Appointments" },
  { key: "products", label: "Products/Services" },
  { key: "staff", label: "Doctors/Staff" },
  { key: "clients", label: "Clients" },
];

/** Bar colors for the client recency buckets (fresh → stale → non-client). */
const RECENCY_COLORS: Record<string, string> = {
  m6: "#10b981",
  m12: "#22c55e",
  m24: "#eab308",
  m36: "#f97316",
  m48: "#ef4444",
  non: "#94a3b8",
};

function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

export interface ReportingTabsProps {
  year: number;
  overview: ReportOverview | null;
  monthly: MonthlyRow[];
  locations: LocationRow[];
  locationMonthly: LocationMonthlyRow[];
  species: SpeciesRow[];
  products: ProductGroupRow[];
  topProducts: TopProductRow[];
  productByLocation: ProductLocationRow[];
  staff: StaffRow[];
  staffByLocation: StaffLocationRow[];
  clientSummary: ClientSummary | null;
  clientsByMonth: ClientsByMonthRow[];
  clientGroups: ClientGroupRow[];
  clientDivisions: ClientGroupRow[];
  clientRecency: ClientRecencyRow[];
  hasClientData: boolean;
}

/** Compact location → revenue/value matrix table. */
function LocationMatrix({
  rowHeader,
  rowKeys,
  locations,
  valueFor,
  format,
}: {
  rowHeader: string;
  rowKeys: { key: string; label: string }[];
  locations: { location_key: LocationKey; location_label: string }[];
  valueFor: (rowKey: string, locationKey: LocationKey) => number;
  format: (n: number) => string;
}) {
  if (rowKeys.length === 0)
    return <p className="text-xs text-slate-400">No data yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              {rowHeader}
            </th>
            {locations.map((l) => (
              <th
                key={l.location_key}
                className="px-2 py-2 text-right text-xs font-semibold text-slate-500"
              >
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{
                      backgroundColor:
                        LOCATION_COLORS[l.location_key] ?? "#94a3b8",
                    }}
                  />
                  {l.location_label}
                </span>
              </th>
            ))}
            <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rowKeys.map((r) => {
            const cells = locations.map((l) => valueFor(r.key, l.location_key));
            const total = cells.reduce((s, n) => s + n, 0);
            return (
              <tr
                key={r.key}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="py-2 pr-3 font-medium text-slate-700">
                  {r.label}
                </td>
                {cells.map((v, i) => (
                  <td
                    key={locations[i].location_key}
                    className="px-2 py-2 text-right tabular-nums text-slate-600"
                  >
                    {v > 0 ? format(v) : "—"}
                  </td>
                ))}
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">
                  {format(total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ReportingTabs(props: ReportingTabsProps) {
  const [tab, setTab] = useState<TabKey>("revenue");
  const {
    year,
    overview,
    monthly,
    locations,
    locationMonthly,
    species,
    products,
    topProducts,
    productByLocation,
    staff,
    staffByLocation,
    clientSummary,
    clientsByMonth,
    clientGroups,
    clientDivisions,
    clientRecency,
    hasClientData,
  } = props;

  const avgAppt =
    overview && overview.total_appointments > 0
      ? overview.total_revenue / overview.total_appointments
      : 0;

  const bestMonth = monthly.reduce<MonthlyRow | null>(
    (best, m) => (!best || m.revenue > best.revenue ? m : best),
    null,
  );

  const totalLocationAppts = locations.reduce(
    (s, l) => s + Number(l.appointments),
    0,
  );

  const doctors = staff.filter((s) => s.is_vet);
  const supportStaff = staff.filter((s) => !s.is_vet);

  // Lookups for the location matrices.
  const prodLoc = new Map<string, number>();
  for (const r of productByLocation)
    prodLoc.set(`${r.product_group}__${r.location_key}`, Number(r.revenue));
  const staffLoc = new Map<string, number>();
  for (const r of staffByLocation)
    staffLoc.set(`${r.staff_member}__${r.location_key}`, Number(r.revenue));

  const locationCols = locations.map((l) => ({
    location_key: l.location_key,
    location_label: l.location_label,
  }));

  const recentClients = clientsByMonth.slice(-1)[0]?.new_clients ?? 0;

  const nonClients = clientRecency
    .filter((r) => r.bucket === "non")
    .reduce((s, r) => s + r.contacts, 0);
  const totalClassified = clientRecency.reduce((s, r) => s + r.contacts, 0);
  const activeClients = totalClassified - nonClients;

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto border-b border-slate-200">
        <nav className="-mb-px flex gap-1">
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-medium transition ${
                  active
                    ? "border-emerald-600 text-emerald-700"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ---------------------------------------------------------------- */}
      {tab === "revenue" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Total Revenue"
              value={fmtCurrency(overview?.total_revenue)}
            />
            <StatCard
              label="Avg / Appointment"
              value={fmtCurrency(avgAppt)}
              accent="amber"
            />
            <StatCard
              label="Best Month"
              value={bestMonth ? fmtCurrency(bestMonth.revenue) : "—"}
              accent="emerald"
              sub={bestMonth ? bestMonth.month : undefined}
            />
            <StatCard
              label="Locations"
              value={fmtNumber(locations.length)}
              accent="indigo"
            />
          </div>

          <SectionCard
            title="Revenue by month"
            description="Total invoiced (incl. tax) per service month."
          >
            <MonthlyBars
              data={monthly as unknown as { month: string; [k: string]: string | number }[]}
              valueKey="revenue"
              format={(n) => fmtCurrency(n)}
              color="#10b981"
            />
          </SectionCard>

          <SectionCard
            title="Revenue by location over time"
            description="Stacked monthly revenue, segmented by clinic location."
          >
            <StackedMonthlyBars
              rows={locationMonthly}
              metric="revenue"
              format={(n) => fmtCurrency(n)}
            />
          </SectionCard>

          <SectionCard
            title="Monthly revenue by clinic"
            description="Each clinic's revenue per month, on a shared scale for comparison."
          >
            <LocationMonthlyGrid
              rows={locationMonthly}
              locations={locations}
              metric="revenue"
              format={(n) => fmtCurrency(n)}
            />
          </SectionCard>

          <SectionCard
            title="Revenue by clinic location"
            description="Total and average appointment value per location."
          >
            <BarList
              items={locations.map((l) => ({
                label: l.location_label,
                value: l.revenue,
                display: `${fmtCurrency(l.revenue)} · ${fmtCurrency(l.avg_appointment_value)} avg`,
                color: LOCATION_COLORS[l.location_key as LocationKey] ?? "#10b981",
              }))}
            />
          </SectionCard>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === "appointments" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Appointments"
              value={fmtNumber(overview?.total_appointments)}
              accent="indigo"
              sub={`${fmtNumber(overview?.total_lines)} invoice lines`}
            />
            <StatCard
              label="Unique Clients"
              value={fmtNumber(overview?.unique_clients)}
              accent="sky"
            />
            <StatCard
              label="Avg / Appointment"
              value={fmtCurrency(avgAppt)}
              accent="amber"
            />
            <StatCard
              label="Species Tracked"
              value={fmtNumber(species.length)}
            />
          </div>

          {/* Default breakdown: appointments per clinic location. */}
          <SectionCard
            title="Appointments by location"
            description="Volume, share of total, and unique clients per clinic."
          >
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {locations.map((l) => {
                const share =
                  totalLocationAppts > 0
                    ? Math.round((l.appointments / totalLocationAppts) * 100)
                    : 0;
                return (
                  <div
                    key={l.location_key}
                    className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm"
                  >
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{
                          backgroundColor:
                            LOCATION_COLORS[l.location_key as LocationKey] ??
                            "#94a3b8",
                        }}
                      />
                      {l.location_label}
                    </p>
                    <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                      {fmtNumber(l.appointments)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {share}% of total · {fmtNumber(l.unique_clients)} clients
                    </p>
                  </div>
                );
              })}
            </div>
            <BarList
              items={locations.map((l) => ({
                label: l.location_label,
                value: l.appointments,
                display: `${fmtNumber(l.appointments)} appts · ${fmtCurrency(l.avg_appointment_value)} avg`,
                color: LOCATION_COLORS[l.location_key as LocationKey] ?? "#10b981",
              }))}
            />
          </SectionCard>

          {/* Per-location monthly trend, small multiples on a shared scale. */}
          <SectionCard
            title="Monthly appointments by location"
            description="Each clinic's monthly trend, on a shared scale for comparison."
          >
            <LocationMonthlyGrid
              rows={locationMonthly}
              locations={locations}
              metric="appointments"
              format={(n) => fmtNumber(n)}
            />
          </SectionCard>

          <SectionCard
            title="Appointments by location over time"
            description="Stacked monthly appointment volume per clinic location."
          >
            <StackedMonthlyBars
              rows={locationMonthly}
              metric="appointments"
              format={(n) => fmtNumber(n)}
            />
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="All locations — monthly total"
              description="Same client + same day + same clinic = one appointment."
            >
              <MonthlyBars
                data={monthly as unknown as { month: string; [k: string]: string | number }[]}
                valueKey="appointments"
                format={(n) => fmtNumber(n)}
                color="#6366f1"
              />
            </SectionCard>
            <SectionCard
              title="By species"
              description="Appointment mix across dogs, cats, and exotics."
            >
              <BarList
                items={species.map((s) => ({
                  label: s.species_group,
                  value: s.appointments,
                  display: `${fmtNumber(s.appointments)} appts · ${fmtCurrency(s.revenue)}`,
                  color: SPECIES_COLORS[s.species_group] ?? "#94a3b8",
                }))}
              />
            </SectionCard>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === "products" && (
        <div className="space-y-6">
          <SectionCard
            title="Top product groups by revenue"
            description="Where the money is coming from across all invoice lines."
          >
            <BarList
              items={products.map((p) => ({
                label: p.product_group,
                value: p.revenue,
                display: `${fmtCurrency(p.revenue)} · ${fmtNumber(p.line_count)} lines`,
              }))}
            />
          </SectionCard>

          <SectionCard
            title="Product groups by location"
            description="Revenue per product group, split across clinics."
          >
            <LocationMatrix
              rowHeader="Product group"
              rowKeys={products
                .slice(0, 10)
                .map((p) => ({ key: p.product_group, label: p.product_group }))}
              locations={locationCols}
              valueFor={(g, loc) => prodLoc.get(`${g}__${loc}`) ?? 0}
              format={(n) => fmtCurrency(n)}
            />
          </SectionCard>

          <SectionCard
            title="Top individual products & services"
            description="Highest-revenue line items across every clinic."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Product
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-semibold text-slate-500">
                      Group
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
                      Qty
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
                      Lines
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
                      Revenue
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.slice(0, 20).map((p, i) => (
                    <tr
                      key={`${p.product_name}-${i}`}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="py-2 pr-3 font-medium text-slate-700">
                        {p.product_name}
                      </td>
                      <td className="px-2 py-2 text-slate-500">
                        {p.product_group}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                        {fmtNumber(p.qty)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                        {fmtNumber(p.line_count)}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">
                        {fmtCurrency(p.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === "staff" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Doctors"
              value={fmtNumber(doctors.length)}
              accent="emerald"
            />
            <StatCard
              label="Support Staff"
              value={fmtNumber(supportStaff.length)}
              accent="indigo"
            />
            <StatCard
              label="Top Producer"
              value={staff[0]?.staff_member ?? "—"}
              accent="amber"
              sub={staff[0] ? fmtCurrency(staff[0].revenue) : undefined}
            />
            <StatCard
              label="Total Consults"
              value={fmtNumber(staff.reduce((s, x) => s + x.consults, 0))}
              accent="sky"
            />
          </div>

          <SectionCard
            title="Doctors by production"
            description="Revenue, appointments, and consults attributed to each veterinarian."
          >
            <StaffTable rows={doctors} year={year} />
          </SectionCard>

          <SectionCard
            title="Support staff by production"
            description="Non-veterinarian salespeople and technicians."
          >
            <StaffTable rows={supportStaff} year={year} />
          </SectionCard>

          <SectionCard
            title="Provider production by location"
            description="Revenue per provider, split across clinics."
          >
            <LocationMatrix
              rowHeader="Provider"
              rowKeys={staff
                .slice(0, 12)
                .map((s) => ({ key: s.staff_member, label: s.staff_member }))}
              locations={locationCols}
              valueFor={(name, loc) => staffLoc.get(`${name}__${loc}`) ?? 0}
              format={(n) => fmtCurrency(n)}
            />
          </SectionCard>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === "clients" && (
        <div className="space-y-6">
          {!hasClientData ? (
            <SectionCard
              title="No client data yet"
              description="Sourced from the ezyVet CRM."
            >
              <p className="text-sm text-slate-500">
                Head to the{" "}
                <a className="font-medium text-emerald-600 underline" href="/ezyvet">
                  ezyVet CRM
                </a>{" "}
                and upload a Contacts export to unlock client growth, customer
                groups, and division trends.
              </p>
            </SectionCard>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                  label="Total Contacts"
                  value={fmtNumber(clientSummary?.total_contacts)}
                  sub={`${fmtNumber(clientSummary?.active_contacts)} active`}
                />
                <StatCard
                  label="Customers"
                  value={fmtNumber(clientSummary?.customers)}
                  accent="indigo"
                />
                <StatCard
                  label="Revenue YTD"
                  value={fmtCurrency(clientSummary?.total_revenue_ytd)}
                  accent="emerald"
                  sub={`${fmtCurrency(clientSummary?.avg_revenue_ytd)} avg/customer`}
                />
                <StatCard
                  label="New (latest month)"
                  value={fmtNumber(recentClients)}
                  accent="sky"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                  label="Active Clients"
                  value={fmtNumber(activeClients)}
                  accent="emerald"
                  sub={`${pct(activeClients, totalClassified)} of base`}
                />
                <StatCard
                  label="Non-Clients"
                  value={fmtNumber(nonClients)}
                  accent="slate"
                  sub="Blank or $0 account spend"
                />
              </div>

              <SectionCard
                title="Client recency"
                description="Active clients bucketed by how recently they were last invoiced. Non-Clients have a blank or $0 account spend."
              >
                <BarList
                  items={clientRecency.map((r) => ({
                    label: r.label,
                    value: r.contacts,
                    display: `${fmtNumber(r.contacts)} · ${pct(r.contacts, totalClassified)}`,
                    color: RECENCY_COLORS[r.bucket] ?? "#10b981",
                  }))}
                />
              </SectionCard>

              <SectionCard
                title="New clients by month"
                description="Growth derived from ezyVet contact created dates."
                action={
                  <a
                    href="/ezyvet"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    Open ezyVet CRM →
                  </a>
                }
              >
                <MonthlyBars
                  data={
                    clientsByMonth.slice(-18) as unknown as {
                      month: string;
                      [k: string]: string | number;
                    }[]
                  }
                  valueKey="new_clients"
                  format={(n) => fmtNumber(n)}
                  color="#0ea5e9"
                />
              </SectionCard>

              <div className="grid gap-6 lg:grid-cols-2">
                <SectionCard
                  title="Active clients by location"
                  description="Unique invoiced clients per clinic."
                >
                  <BarList
                    items={locations.map((l) => ({
                      label: l.location_label,
                      value: l.unique_clients,
                      display: `${fmtNumber(l.unique_clients)} clients`,
                      color: LOCATION_COLORS[l.location_key as LocationKey] ?? "#10b981",
                    }))}
                  />
                </SectionCard>
                <SectionCard
                  title="By customer group"
                  description="Contact counts and YTD revenue per group."
                >
                  <BarList
                    items={clientGroups.map((g) => ({
                      label: g.customer_group ?? "Ungrouped",
                      value: g.contacts,
                      display: `${fmtNumber(g.contacts)} · ${fmtCurrency(g.revenue_ytd)}`,
                      color: "#6366f1",
                    }))}
                  />
                </SectionCard>
              </div>

              <SectionCard
                title="By division"
                description="YTD revenue and contacts per division."
              >
                <BarList
                  items={clientDivisions.map((g) => ({
                    label: g.division ?? "Unassigned",
                    value: g.revenue_ytd,
                    display: `${fmtCurrency(g.revenue_ytd)} · ${fmtNumber(g.contacts)} contacts`,
                    color: "#f59e0b",
                  }))}
                />
              </SectionCard>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Staff production table shared by the Doctors and Support Staff sections. */
function StaffTable({ rows, year }: { rows: StaffRow[]; year: number }) {
  const [selected, setSelected] = useState<StaffRow | null>(null);
  const [breakdown, setBreakdown] = useState<StaffBreakdown | null>(null);
  const [loading, setLoading] = useState(false);

  if (rows.length === 0)
    return <p className="text-xs text-slate-400">No data yet.</p>;
  const max = Math.max(1, ...rows.map((r) => Number(r.revenue)));

  async function openProvider(row: StaffRow) {
    if (selected?.staff_member === row.staff_member) {
      setSelected(null);
      setBreakdown(null);
      return;
    }
    setSelected(row);
    setBreakdown(null);
    setLoading(true);
    try {
      const data = await getStaffBreakdown(row.staff_member, year);
      setBreakdown(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Provider
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
              Appts
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
              Consults
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
              Lines
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
              Revenue
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = selected?.staff_member === r.staff_member;
            return (
              <Fragment key={r.staff_member}>
                <tr
                  className={`border-b border-slate-100 last:border-0 ${
                    isOpen ? "bg-emerald-50/40" : ""
                  }`}
                >
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => openProvider(r)}
                      className="text-left font-medium text-emerald-700 transition hover:text-emerald-800 hover:underline"
                      aria-expanded={isOpen}
                    >
                      {r.staff_member}
                      <span className="ml-1.5 text-[10px] text-slate-400">
                        {isOpen ? "▾" : "▸"}
                      </span>
                    </button>
                    <div className="mt-1 h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${(Number(r.revenue) / max) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                    {fmtNumber(r.appointments)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                    {fmtNumber(r.consults)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                    {fmtNumber(r.line_count)}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">
                    {fmtCurrency(r.revenue)}
                  </td>
                </tr>
                {isOpen ? (
                  <tr key={`${r.staff_member}-detail`}>
                    <td colSpan={5} className="bg-slate-50/70 px-3 py-4">
                      <StaffDetail
                        row={r}
                        breakdown={breakdown}
                        loading={loading}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Drill-down panel: per-appointment averages + top groups/products. */
function StaffDetail({
  row,
  breakdown,
  loading,
}: {
  row: StaffRow;
  breakdown: StaffBreakdown | null;
  loading: boolean;
}) {
  const avgRevenue =
    row.appointments > 0 ? Number(row.revenue) / row.appointments : 0;
  const avgLines =
    row.appointments > 0 ? Number(row.line_count) / row.appointments : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Revenue / Appt"
          value={fmtCurrency(avgRevenue)}
          accent="emerald"
        />
        <StatCard
          label="Lines / Appt"
          value={avgLines.toFixed(1)}
          accent="indigo"
          sub={`${fmtNumber(row.line_count)} lines`}
        />
        <StatCard
          label="Appointments"
          value={fmtNumber(row.appointments)}
          accent="sky"
          sub={`${fmtNumber(row.consults)} consults`}
        />
        <StatCard
          label="Total Revenue"
          value={fmtCurrency(row.revenue)}
          accent="amber"
        />
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Loading breakdown…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Top product groups
            </h4>
            <BarList
              items={(breakdown?.topGroups ?? []).map((g) => ({
                label: g.product_group,
                value: Number(g.revenue),
                display: `${fmtCurrency(g.revenue)} · ${fmtNumber(g.line_count)} lines`,
                color: "#6366f1",
              }))}
            />
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Top products / services
            </h4>
            <BarList
              items={(breakdown?.topProducts ?? []).map((p) => ({
                label: p.product_name,
                value: Number(p.revenue),
                display: `${fmtCurrency(p.revenue)} · ${fmtNumber(p.line_count)} lines`,
                color: "#10b981",
              }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Small-multiples grid: one monthly trend chart per clinic location, all on a
 * shared scale so volumes are directly comparable across clinics.
 */
function LocationMonthlyGrid({
  rows,
  locations,
  metric,
  format,
}: {
  rows: LocationMonthlyRow[];
  locations: LocationRow[];
  metric: "appointments" | "revenue";
  format: (n: number) => string;
}) {
  if (rows.length === 0)
    return <p className="text-xs text-slate-400">No data yet.</p>;

  const months = [...new Set(rows.map((r) => r.month))].sort();
  const sharedMax = Math.max(1, ...rows.map((r) => Number(r[metric] ?? 0)));

  // Order locations by total volume of the displayed metric, largest first.
  const ordered = [...locations].sort(
    (a, b) => Number(b[metric]) - Number(a[metric]),
  );

  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {ordered.map((l) => {
        const color = LOCATION_COLORS[l.location_key as LocationKey] ?? "#10b981";
        const series = months.map((m) => {
          const found = rows.find(
            (r) => r.location_key === l.location_key && r.month === m,
          );
          return { month: m, [metric]: found ? Number(found[metric]) : 0 };
        });
        const total = series.reduce((s, r) => s + Number(r[metric] ?? 0), 0);
        return (
          <div
            key={l.location_key}
            className="rounded-xl border border-slate-100 bg-slate-50/50 p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: color }}
                />
                {l.location_label}
              </span>
              <span className="text-[11px] tabular-nums text-slate-500">
                {format(total)}
              </span>
            </div>
            <MonthlyBars
              data={series}
              valueKey={metric}
              format={format}
              color={color}
              max={sharedMax}
            />
          </div>
        );
      })}
    </div>
  );
}
