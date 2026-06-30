"use client";

import { useState } from "react";
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
  ClientSummary,
  ClientsByMonthRow,
  ClientGroupRow,
  LocationKey,
} from "@/lib/reporting/types";
import { LOCATION_COLORS, SPECIES_COLORS } from "@/lib/reporting/types";
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

export interface ReportingTabsProps {
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

          <SectionCard
            title="Appointments by month"
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
              title="By clinic location"
              description="Parsed from the invoice Department / Inventory Location."
            >
              <BarList
                items={locations.map((l) => ({
                  label: l.location_label,
                  value: l.appointments,
                  display: `${fmtNumber(l.appointments)} appts · ${fmtNumber(l.unique_clients)} clients`,
                  color: LOCATION_COLORS[l.location_key as LocationKey] ?? "#10b981",
                }))}
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
            <StaffTable rows={doctors} />
          </SectionCard>

          <SectionCard
            title="Support staff by production"
            description="Non-veterinarian salespeople and technicians."
          >
            <StaffTable rows={supportStaff} />
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
function StaffTable({ rows }: { rows: StaffRow[] }) {
  if (rows.length === 0)
    return <p className="text-xs text-slate-400">No data yet.</p>;
  const max = Math.max(1, ...rows.map((r) => Number(r.revenue)));
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
          {rows.map((r) => (
            <tr
              key={r.staff_member}
              className="border-b border-slate-100 last:border-0"
            >
              <td className="py-2 pr-3">
                <div className="font-medium text-slate-700">{r.staff_member}</div>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
