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
  CaseOwnerMonthRow,
  DvmDeptRow,
  StaffBreakdown,
  ClientSummary,
  ClientsByMonthRow,
  ClientRecencyRow,
  ClientRecencyLocationRow,
  SpeciesPatientsRow,
  SpeciesRecencyRow,
  LocationKey,
  InvoiceImportRow,
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
import { ImportHistory } from "./import-history";
import { AppointmentReview } from "./appointment-review";
import { useTableSort, SortHeader, stickyHeadClass } from "../_components/data-views";

type TabKey =
  | "revenue"
  | "appointments"
  | "appointment-review"
  | "products"
  | "staff"
  | "dvm-dept"
  | "clients"
  | "uploads";

const TABS: { key: TabKey; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "appointments", label: "Appointments" },
  { key: "appointment-review", label: "Appointment Review" },
  { key: "products", label: "Products/Services" },
  { key: "staff", label: "Doctors/Staff" },
  { key: "dvm-dept", label: "DVM by Dept" },
  { key: "clients", label: "Clients" },
  { key: "uploads", label: "Uploads" },
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

/** Colors for the visit-recency buckets used in the by-location grid. */
const RECENCY_GRID_COLORS: Record<string, string> = {
  m6: "#10b981",
  m12: "#22c55e",
  m24: "#eab308",
  m36: "#f97316",
  m48: "#ef4444",
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
  caseOwners: StaffRow[];
  staffByLocation: StaffLocationRow[];
  caseOwnerByMonth: CaseOwnerMonthRow[];
  dvmByDept: DvmDeptRow[];
  clientSummary: ClientSummary | null;
  clientsByMonth: ClientsByMonthRow[];
  clientRecency: ClientRecencyRow[];
  clientRecencyLocation: ClientRecencyLocationRow[];
  speciesPatients: SpeciesPatientsRow[];
  speciesRecency: SpeciesRecencyRow[];
  hasClientData: boolean;
  imports: InvoiceImportRow[];
  isAdmin: boolean;
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

/** Species × recency matrix: patient counts per species per last-visit bucket. */
function SpeciesRecencyMatrix({ rows }: { rows: SpeciesRecencyRow[] }) {
  if (rows.length === 0)
    return <p className="text-xs text-slate-400">No data yet.</p>;

  // Recency buckets (columns), in display order, dropping any that are empty
  // across every species (e.g. the window-edge "6 Mo+" when there is no data).
  const bucketTotals = new Map<string, { label: string; order: number; total: number }>();
  for (const r of rows) {
    const b = bucketTotals.get(r.bucket) ?? {
      label: r.label,
      order: r.sort_order,
      total: 0,
    };
    b.total += r.patients;
    bucketTotals.set(r.bucket, b);
  }
  const buckets = [...bucketTotals.entries()]
    .filter(([, b]) => b.total > 0)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, b]) => ({ key, label: b.label }));

  // Species rows, dropping any species with no patients in the window.
  const speciesKeys = [...new Set(rows.map((r) => r.species_group))].filter(
    (sp) => rows.some((r) => r.species_group === sp && r.patients > 0),
  );

  const cell = (sp: string, bucket: string): number =>
    rows.find((r) => r.species_group === sp && r.bucket === bucket)?.patients ?? 0;

  const colTotal = (bucket: string): number =>
    rows.filter((r) => r.bucket === bucket).reduce((s, r) => s + r.patients, 0);
  const rowTotal = (sp: string): number =>
    rows.filter((r) => r.species_group === sp).reduce((s, r) => s + r.patients, 0);
  const grandTotal = rows.reduce((s, r) => s + r.patients, 0);

  if (speciesKeys.length === 0 || buckets.length === 0)
    return <p className="text-xs text-slate-400">No data yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Species
            </th>
            {buckets.map((b) => (
              <th
                key={b.key}
                className="px-2 py-2 text-right text-xs font-semibold text-slate-500"
              >
                {b.label}
              </th>
            ))}
            <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {speciesKeys.map((sp) => (
            <tr key={sp} className="border-b border-slate-100">
              <td className="py-2 pr-3 font-medium text-slate-700">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{
                      backgroundColor:
                        SPECIES_COLORS[sp as keyof typeof SPECIES_COLORS] ??
                        "#94a3b8",
                    }}
                  />
                  {sp}
                </span>
              </td>
              {buckets.map((b) => {
                const v = cell(sp, b.key);
                return (
                  <td
                    key={b.key}
                    className="px-2 py-2 text-right tabular-nums text-slate-600"
                  >
                    {v > 0 ? fmtNumber(v) : "—"}
                  </td>
                );
              })}
              <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">
                {fmtNumber(rowTotal(sp))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200">
            <td className="py-2 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Total
            </td>
            {buckets.map((b) => (
              <td
                key={b.key}
                className="px-2 py-2 text-right font-semibold tabular-nums text-slate-700"
              >
                {fmtNumber(colTotal(b.key))}
              </td>
            ))}
            <td className="px-2 py-2 text-right font-bold tabular-nums text-slate-900">
              {fmtNumber(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Recency buckets (rows) × clinic locations (columns) contact counts. */
function ClientRecencyLocationMatrix({
  rows,
}: {
  rows: ClientRecencyLocationRow[];
}) {
  if (rows.length === 0)
    return <p className="text-xs text-slate-400">No data yet.</p>;

  // Location columns, in their canonical order, dropping any with no contacts.
  const locMap = new Map<
    LocationKey,
    { label: string; order: number; total: number }
  >();
  for (const r of rows) {
    const l = locMap.get(r.location_key) ?? {
      label: r.location_label,
      order: r.location_order,
      total: 0,
    };
    l.total += r.contacts;
    locMap.set(r.location_key, l);
  }
  const locations = [...locMap.entries()]
    .filter(([, l]) => l.total > 0)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, l]) => ({ key, label: l.label }));

  // Recency rows, in bucket order, dropping any empty across every location.
  const bucketMap = new Map<
    string,
    { label: string; order: number; total: number }
  >();
  for (const r of rows) {
    const b = bucketMap.get(r.bucket) ?? {
      label: r.label,
      order: r.sort_order,
      total: 0,
    };
    b.total += r.contacts;
    bucketMap.set(r.bucket, b);
  }
  const buckets = [...bucketMap.entries()]
    .filter(([, b]) => b.total > 0)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, b]) => ({ key, label: b.label }));

  const cell = (bucket: string, loc: LocationKey): number =>
    rows.find((r) => r.bucket === bucket && r.location_key === loc)?.contacts ??
    0;
  const rowTotal = (bucket: string): number =>
    rows.filter((r) => r.bucket === bucket).reduce((s, r) => s + r.contacts, 0);
  const colTotal = (loc: LocationKey): number =>
    rows
      .filter((r) => r.location_key === loc)
      .reduce((s, r) => s + r.contacts, 0);
  const grandTotal = rows.reduce((s, r) => s + r.contacts, 0);

  if (locations.length === 0 || buckets.length === 0)
    return <p className="text-xs text-slate-400">No data yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Recency
            </th>
            {locations.map((l) => (
              <th
                key={l.key}
                className="px-2 py-2 text-right text-xs font-semibold text-slate-500"
              >
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{
                      backgroundColor: LOCATION_COLORS[l.key] ?? "#94a3b8",
                    }}
                  />
                  {l.label}
                </span>
              </th>
            ))}
            <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.key} className="border-b border-slate-100">
              <td className="py-2 pr-3 font-medium text-slate-700">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ backgroundColor: RECENCY_GRID_COLORS[b.key] ?? "#10b981" }}
                  />
                  {b.label}
                </span>
              </td>
              {locations.map((l) => {
                const v = cell(b.key, l.key);
                return (
                  <td
                    key={l.key}
                    className="px-2 py-2 text-right tabular-nums text-slate-600"
                  >
                    {v > 0 ? fmtNumber(v) : "—"}
                  </td>
                );
              })}
              <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">
                {fmtNumber(rowTotal(b.key))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200">
            <td className="py-2 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Total
            </td>
            {locations.map((l) => (
              <td
                key={l.key}
                className="px-2 py-2 text-right font-semibold tabular-nums text-slate-700"
              >
                {fmtNumber(colTotal(l.key))}
              </td>
            ))}
            <td className="px-2 py-2 text-right font-bold tabular-nums text-slate-900">
              {fmtNumber(grandTotal)}
            </td>
          </tr>
        </tfoot>
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
    caseOwners,
    staffByLocation,
    caseOwnerByMonth,
    dvmByDept,
    clientSummary,
    clientsByMonth,
    clientRecency,
    clientRecencyLocation,
    speciesPatients,
    speciesRecency,
    hasClientData,
    imports,
    isAdmin,
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

  // Doctors are attributed by Case Owner (falling back to Staff Member when the
  // case owner is blank); support staff stay on Staff Member.
  const doctors = caseOwners.filter((s) => s.is_vet);
  const supportStaff = staff.filter((s) => !s.is_vet);

  // Highest-revenue provider among case-owning doctors.
  const topProducer = doctors.reduce<StaffRow | null>(
    (best, s) => (best && Number(best.revenue) >= Number(s.revenue) ? best : s),
    null,
  );

  // Lookups for the location matrices.
  const prodLoc = new Map<string, number>();
  for (const r of productByLocation)
    prodLoc.set(`${r.product_group}__${r.location_key}`, Number(r.revenue));
  const staffLoc = new Map<string, number>();
  for (const r of staffByLocation)
    staffLoc.set(`${r.staff_member}__${r.location_key}`, Number(r.revenue));

  // Providers (case owners) ranked by total revenue across clinics.
  const providerTotals = new Map<string, number>();
  for (const r of staffByLocation)
    providerTotals.set(
      r.staff_member,
      (providerTotals.get(r.staff_member) ?? 0) + Number(r.revenue),
    );
  const topProviders = [...providerTotals.entries()]
    .filter(([name]) => name && name !== "Unassigned")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name]) => ({ key: name, label: name }));

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
            <div className="max-h-[70vh] overflow-auto">
              <TopProductsTable rows={topProducts} />
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
              value={topProducer?.staff_member ?? "—"}
              accent="amber"
              sub={topProducer ? fmtCurrency(topProducer.revenue) : undefined}
            />
            <StatCard
              label="Total Appointments"
              value={fmtNumber(doctors.reduce((s, x) => s + x.appointments, 0))}
              accent="sky"
            />
          </div>

          <SectionCard
            title="Doctors by production"
            description="Revenue and appointments attributed to each case-owning veterinarian."
          >
            <StaffTable rows={doctors} year={year} byCaseOwner />
          </SectionCard>

          <SectionCard
            title="Support staff by production"
            description="Non-veterinarian salespeople and technicians."
          >
            <StaffTable rows={supportStaff} year={year} />
          </SectionCard>

          <SectionCard
            title="Provider production by location"
            description="Revenue per case-owning provider, split across clinics."
          >
            <LocationMatrix
              rowHeader="Provider"
              rowKeys={topProviders}
              locations={locationCols}
              valueFor={(name, loc) => staffLoc.get(`${name}__${loc}`) ?? 0}
              format={(n) => fmtCurrency(n)}
            />
          </SectionCard>

          <SectionCard
            title="Case owner sales by month"
            description="Monthly sales for each case-owning provider. Expand a provider to view their trend."
          >
            <CaseOwnerMonthlySales rows={caseOwnerByMonth} />
          </SectionCard>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === "dvm-dept" && (
        <div className="space-y-6">
          <SectionCard
            title="DVM performance by department"
            description="Each doctor's production attributed to the department the published schedule placed them in that day, using the matching day's ezyVet invoices. Expand a doctor to see their per-department breakdown."
          >
            <DvmByDeptTable rows={dvmByDept} />
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
                  label="New (latest month)"
                  value={fmtNumber(recentClients)}
                  accent="sky"
                />
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
                title="Client recency by location"
                description="Each invoiced client bucketed by how recently they last visited and split by that visit's clinic. Cohorts deepen automatically as older invoice months are imported."
              >
                <ClientRecencyLocationMatrix rows={clientRecencyLocation} />
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
                  title="Patients by species"
                  description="Distinct patients seen per species, from the uploaded invoice window."
                >
                  <BarList
                    items={speciesPatients.map((s) => ({
                      label: s.species_group,
                      value: s.patients,
                      display: `${fmtNumber(s.patients)} pets · ${fmtNumber(s.clients)} clients`,
                      color: SPECIES_COLORS[s.species_group as keyof typeof SPECIES_COLORS] ?? "#6366f1",
                    }))}
                  />
                </SectionCard>
              </div>

              <SectionCard
                title="Species by recency"
                description="Patients grouped by species and how recently each was last seen, within the uploaded invoice window."
              >
                <SpeciesRecencyMatrix rows={speciesRecency} />
              </SectionCard>
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === "appointment-review" && <AppointmentReview />}

      {tab === "uploads" && (
        <div className="space-y-6">
          <SectionCard
            title="Upload history"
            description="Every monthly invoice import, newest first."
          >
            <ImportHistory imports={imports} isAdmin={isAdmin} />
          </SectionCard>
        </div>
      )}
    </div>
  );
}

/** Collapsible per-case-owner monthly sales. One provider open at a time. */
function CaseOwnerMonthlySales({ rows }: { rows: CaseOwnerMonthRow[] }) {
  const [open, setOpen] = useState<string | null>(null);

  const byOwner = new Map<string, CaseOwnerMonthRow[]>();
  for (const r of rows) {
    const arr = byOwner.get(r.case_owner) ?? [];
    arr.push(r);
    byOwner.set(r.case_owner, arr);
  }
  const owners = [...byOwner.entries()]
    .map(([name, months]) => ({
      name,
      months: [...months].sort((a, b) => a.month.localeCompare(b.month)),
      total: months.reduce((s, m) => s + Number(m.revenue), 0),
    }))
    .sort((a, b) => b.total - a.total);

  if (owners.length === 0)
    return <p className="text-xs text-slate-400">No case owner data yet.</p>;

  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
      {owners.map((o) => {
        const isOpen = open === o.name;
        return (
          <div key={o.name}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : o.name)}
              className={`flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-slate-50 ${
                isOpen ? "bg-indigo-50/50" : ""
              }`}
              aria-expanded={isOpen}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <span className="text-[10px] text-slate-400">
                  {isOpen ? "▾" : "▸"}
                </span>
                {o.name}
              </span>
              <span className="tabular-nums text-sm font-semibold text-indigo-700">
                {fmtCurrency(o.total)}
              </span>
            </button>
            {isOpen ? (
              <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4">
                <MonthlyBars
                  data={o.months.map((m) => ({
                    month: m.month,
                    revenue: Number(m.revenue),
                  }))}
                  valueKey="revenue"
                  format={(n) => fmtCurrency(n)}
                  color="#6366f1"
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Staff production table shared by the Doctors and Support Staff sections. */
type StaffSortKey =
  | "staff_member"
  | "appointments"
  | "line_count"
  | "revenue";

function StaffTable({
  rows,
  year,
  byCaseOwner = false,
}: {
  rows: StaffRow[];
  year: number;
  byCaseOwner?: boolean;
}) {
  const [selected, setSelected] = useState<StaffRow | null>(null);
  const [breakdown, setBreakdown] = useState<StaffBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<StaffSortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  if (rows.length === 0)
    return <p className="text-xs text-slate-400">No data yet.</p>;
  const max = Math.max(1, ...rows.map((r) => Number(r.revenue)));

  function toggleSort(key: StaffSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Names default to ascending (A→Z); numeric columns to descending.
      setSortDir(key === "staff_member" ? "asc" : "desc");
    }
  }

  const sortedRows = [...rows].sort((a, b) => {
    let cmp: number;
    if (sortKey === "staff_member") {
      cmp = a.staff_member.localeCompare(b.staff_member);
    } else {
      cmp = Number(a[sortKey]) - Number(b[sortKey]);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

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
      const data = await getStaffBreakdown(row.staff_member, year, byCaseOwner);
      setBreakdown(data);
    } finally {
      setLoading(false);
    }
  }

  const arrow = (key: StaffSortKey) =>
    key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <button
                type="button"
                onClick={() => toggleSort("staff_member")}
                className={`transition hover:text-slate-600 ${
                  sortKey === "staff_member" ? "text-slate-600" : ""
                }`}
                aria-sort={
                  sortKey === "staff_member"
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                Provider{arrow("staff_member")}
              </button>
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
              <button
                type="button"
                onClick={() => toggleSort("appointments")}
                className={`transition hover:text-slate-700 ${
                  sortKey === "appointments" ? "text-slate-700" : ""
                }`}
                aria-sort={
                  sortKey === "appointments"
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                Appts{arrow("appointments")}
              </button>
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
              <button
                type="button"
                onClick={() => toggleSort("line_count")}
                className={`transition hover:text-slate-700 ${
                  sortKey === "line_count" ? "text-slate-700" : ""
                }`}
                aria-sort={
                  sortKey === "line_count"
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                Lines{arrow("line_count")}
              </button>
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold text-slate-500">
              <button
                type="button"
                onClick={() => toggleSort("revenue")}
                className={`transition hover:text-slate-700 ${
                  sortKey === "revenue" ? "text-slate-700" : ""
                }`}
                aria-sort={
                  sortKey === "revenue"
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                Revenue{arrow("revenue")}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => {
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
                    {fmtNumber(r.line_count)}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">
                    {fmtCurrency(r.revenue)}
                  </td>
                </tr>
                {isOpen ? (
                  <tr key={`${r.staff_member}-detail`}>
                    <td colSpan={4} className="bg-slate-50/70 px-3 py-4">
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
 * Collapsible per-doctor table for the "DVM by Dept" tab. Each doctor's rows
 * (one per department they worked in published schedules) are grouped; the
 * header shows their totals and expands to a per-department breakdown.
 */
function TopProductsTable({ rows }: { rows: TopProductRow[] }) {
  const top = rows.slice(0, 20);
  const sort = useTableSort(top, {
    product: (p) => p.product_name,
    group: (p) => p.product_group,
    qty: (p) => p.qty,
    lines: (p) => p.line_count,
    revenue: (p) => p.revenue,
  });
  return (
    <table className="w-full min-w-[520px] border-collapse text-sm">
      <thead className={stickyHeadClass}>
        <tr className="border-b border-slate-200 text-left">
          <SortHeader label="Product" sortKey="product" sort={sort} className="py-2 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400" />
          <SortHeader label="Group" sortKey="group" sort={sort} className="px-2 py-2 text-xs font-semibold text-slate-500" />
          <SortHeader label="Qty" sortKey="qty" sort={sort} align="right" className="px-2 py-2 text-xs font-semibold text-slate-500" />
          <SortHeader label="Lines" sortKey="lines" sort={sort} align="right" className="px-2 py-2 text-xs font-semibold text-slate-500" />
          <SortHeader label="Revenue" sortKey="revenue" sort={sort} align="right" className="px-2 py-2 text-xs font-semibold text-slate-500" />
        </tr>
      </thead>
      <tbody>
        {sort.sorted.map((p, i) => (
          <tr
            key={`${p.product_name}-${i}`}
            className="border-b border-slate-100 last:border-0"
          >
            <td className="py-2 pr-3 font-medium text-slate-700">{p.product_name}</td>
            <td className="px-2 py-2 text-slate-500">{p.product_group}</td>
            <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmtNumber(p.qty)}</td>
            <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmtNumber(p.line_count)}</td>
            <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">{fmtCurrency(p.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DvmByDeptTable({ rows }: { rows: DvmDeptRow[] }) {
  const [openDoctor, setOpenDoctor] = useState<string | null>(null);

  // Group department rows by doctor and derive each doctor's totals.
  const byDoctor = new Map<string, DvmDeptRow[]>();
  for (const r of rows) {
    const list = byDoctor.get(r.doctor) ?? [];
    list.push(r);
    byDoctor.set(r.doctor, list);
  }

  const doctors = [...byDoctor.entries()]
    .map(([doctor, deptRows]) => {
      const revenue = deptRows.reduce((s, r) => s + Number(r.revenue), 0);
      const appointments = deptRows.reduce((s, r) => s + Number(r.appointments), 0);
      const days = deptRows.reduce((s, r) => s + Number(r.days_worked), 0);
      const depts = [...deptRows].sort((a, b) => Number(b.revenue) - Number(a.revenue));
      return { doctor, revenue, appointments, days, depts };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const sort = useTableSort(doctors, {
    doctor: (d) => d.doctor,
    days: (d) => d.days,
    appts: (d) => d.appointments,
    revenue: (d) => d.revenue,
  });

  const maxRevenue = Math.max(1, ...doctors.map((d) => d.revenue));

  if (rows.length === 0)
    return (
      <p className="text-xs text-slate-400">
        No data yet. This tab needs both published schedules and imported
        invoices whose dates overlap.
      </p>
    );

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead className={stickyHeadClass}>
          <tr className="border-b border-slate-200 text-left">
            <SortHeader label="Doctor" sortKey="doctor" sort={sort} className="py-2 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400" />
            <SortHeader label="Days" sortKey="days" sort={sort} align="right" className="px-2 py-2 text-xs font-semibold text-slate-500" />
            <SortHeader label="Appts" sortKey="appts" sort={sort} align="right" className="px-2 py-2 text-xs font-semibold text-slate-500" />
            <SortHeader label="Revenue" sortKey="revenue" sort={sort} align="right" className="px-2 py-2 text-xs font-semibold text-slate-500" />
          </tr>
        </thead>
        <tbody>
          {sort.sorted.map((d) => {
            const isOpen = openDoctor === d.doctor;
            return (
              <Fragment key={d.doctor}>
                <tr
                  className={`border-b border-slate-100 last:border-0 ${
                    isOpen ? "bg-emerald-50/40" : ""
                  }`}
                >
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => setOpenDoctor(isOpen ? null : d.doctor)}
                      className="text-left font-medium text-emerald-700 transition hover:text-emerald-800 hover:underline"
                      aria-expanded={isOpen}
                    >
                      {d.doctor}
                      <span className="ml-1.5 text-[10px] text-slate-400">
                        {isOpen ? "▾" : "▸"}
                      </span>
                    </button>
                    <div className="mt-1 h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${(d.revenue / maxRevenue) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                    {fmtNumber(d.days)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                    {fmtNumber(d.appointments)}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">
                    {fmtCurrency(d.revenue)}
                  </td>
                </tr>
                {isOpen ? (
                  <tr key={`${d.doctor}-detail`}>
                    <td colSpan={4} className="bg-slate-50/70 px-3 py-4">
                      <DvmDeptDetail depts={d.depts} />
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

/** Per-department breakdown shown when a doctor row is expanded. */
function DvmDeptDetail({ depts }: { depts: DvmDeptRow[] }) {
  const maxRevenue = Math.max(1, ...depts.map((d) => Number(d.revenue)));

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <span>Department</span>
        <span className="text-right">Days</span>
        <span className="text-right">Appts</span>
        <span className="text-right">Rev / Day</span>
      </div>
      {depts.map((d) => {
        const revPerDay =
          Number(d.days_worked) > 0 ? Number(d.revenue) / Number(d.days_worked) : 0;
        return (
          <div key={d.department_name} className="space-y-1">
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 text-sm">
              <span className="flex items-center gap-2 font-medium text-slate-700">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: d.department_color || "#64748b" }}
                />
                {d.department_name}
              </span>
              <span className="text-right tabular-nums text-slate-600">
                {fmtNumber(d.days_worked)}
              </span>
              <span className="text-right tabular-nums text-slate-600">
                {fmtNumber(d.appointments)}
              </span>
              <span className="text-right font-semibold tabular-nums text-slate-800">
                {fmtCurrency(revPerDay)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(Number(d.revenue) / maxRevenue) * 100}%`,
                    backgroundColor: d.department_color || "#64748b",
                  }}
                />
              </div>
              <span className="w-20 text-right text-xs font-medium tabular-nums text-slate-500">
                {fmtCurrency(d.revenue)}
              </span>
            </div>
          </div>
        );
      })}
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
