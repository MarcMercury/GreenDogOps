import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdminRole, canEditModule } from "@/lib/auth/permissions";
import type {
  ReportOverview,
  MonthlyRow,
  LocationRow,
  SpeciesRow,
  ProductGroupRow,
  ClientSummary,
  ClientsByMonthRow,
  ClientGroupRow,
  InvoiceImportRow,
  LocationKey,
} from "@/lib/reporting/types";
import { LOCATION_COLORS, SPECIES_COLORS } from "@/lib/reporting/types";
import { PageHeader } from "../_components/ui";
import {
  StatCard,
  SectionCard,
  BarList,
  MonthlyBars,
  fmtCurrency,
  fmtNumber,
  fmtDate,
} from "./charts";
import { InvoiceUploader } from "./invoice-uploader";
import { ImportHistory } from "./import-history";

export const dynamic = "force-dynamic";

export default async function ReportingPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current ? isAdminRole(current.appUser.role) : false;
  const canEdit = current ? canEditModule(current.appUser, "reporting") : false;

  const [
    overviewRes,
    monthlyRes,
    locationRes,
    speciesRes,
    productRes,
    clientSummaryRes,
    clientsByMonthRes,
    clientGroupRes,
    clientDivisionRes,
    importsRes,
  ] = await Promise.all([
    supabase.from("report_overview").select("*").maybeSingle(),
    supabase.from("report_monthly").select("*"),
    supabase.from("report_by_location").select("*"),
    supabase.from("report_by_species").select("*"),
    supabase.from("report_top_product_group").select("*").limit(12),
    supabase.from("report_client_summary").select("*").maybeSingle(),
    supabase.from("report_clients_by_month").select("*"),
    supabase.from("report_clients_by_group").select("*").limit(10),
    supabase.from("report_clients_by_division").select("*").limit(10),
    supabase
      .from("ezyvet_invoice_import")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(24),
  ]);

  const overview = (overviewRes.data as ReportOverview | null) ?? null;
  const monthly = (monthlyRes.data ?? []) as MonthlyRow[];
  const locations = (locationRes.data ?? []) as LocationRow[];
  const species = (speciesRes.data ?? []) as SpeciesRow[];
  const products = (productRes.data ?? []) as ProductGroupRow[];
  const clientSummary = (clientSummaryRes.data as ClientSummary | null) ?? null;
  const clientsByMonth = (clientsByMonthRes.data ?? []) as ClientsByMonthRow[];
  const clientGroups = (clientGroupRes.data ?? []) as ClientGroupRow[];
  const clientDivisions = (clientDivisionRes.data ?? []) as ClientGroupRow[];
  const imports = (importsRes.data ?? []) as InvoiceImportRow[];

  const hasInvoiceData = (overview?.total_lines ?? 0) > 0;
  const hasClientData = (clientSummary?.total_contacts ?? 0) > 0;

  const avgAppt =
    overview && overview.total_appointments > 0
      ? overview.total_revenue / overview.total_appointments
      : 0;

  // Recent clients are those created in the last 30 days of the contact export.
  const recentClients = clientsByMonth.slice(-1)[0]?.new_clients ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Business Intelligence"
        title="Reporting"
        description="Appointments, revenue, and client trends derived from your ezyVet invoice and contact exports."
      />

      {canEdit ? <InvoiceUploader /> : null}

      {!hasInvoiceData ? (
        <SectionCard
          title="No invoice data yet"
          description="Upload a monthly Invoice Lines export to populate appointment and revenue reporting."
        >
          <p className="text-sm text-slate-500">
            Each invoice line for the same client on the same day at one clinic
            is rolled up into a single appointment. Once you upload, this page
            fills with appointment volume, revenue trends, and a breakdown by
            location and species.
          </p>
        </SectionCard>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Total Revenue"
              value={fmtCurrency(overview?.total_revenue)}
              sub={
                overview?.first_date
                  ? `${fmtDate(overview.first_date)} – ${fmtDate(overview.last_date)}`
                  : undefined
              }
            />
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
          </div>

          {/* Monthly trends */}
          <div className="grid gap-6 lg:grid-cols-2">
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
          </div>

          {/* Location + species */}
          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="By clinic location"
              description="Parsed from the invoice Department / Inventory Location."
            >
              <BarList
                items={locations.map((l) => ({
                  label: l.location_label,
                  value: l.appointments,
                  display: `${fmtNumber(l.appointments)} appts · ${fmtCurrency(l.revenue)}`,
                  color: LOCATION_COLORS[l.location_key as LocationKey] ?? "#10b981",
                }))}
              />
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {locations.map((l) => (
                  <div
                    key={l.location_key}
                    className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"
                  >
                    <p className="text-xs font-semibold text-slate-700">
                      {l.location_label}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {fmtNumber(l.unique_clients)} clients
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {fmtCurrency(l.avg_appointment_value)} avg
                    </p>
                  </div>
                ))}
              </div>
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

          {/* Top product groups */}
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
        </>
      )}

      {/* Client Data & Trends — driven from the ezyVet CRM */}
      <SectionCard
        title="Client Data & Trends"
        description="Sourced from the ezyVet CRM. Upload contact exports to keep this current."
        action={
          <a
            href="/ezyvet"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Open ezyVet CRM →
          </a>
        }
      >
        {!hasClientData ? (
          <p className="text-sm text-slate-500">
            No contact data yet. Head to the{" "}
            <a className="font-medium text-emerald-600 underline" href="/ezyvet">
              ezyVet CRM
            </a>{" "}
            and upload a Contacts export to unlock client growth, customer
            groups, and division trends.
          </p>
        ) : (
          <div className="space-y-6">
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

            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  New clients by month
                </h3>
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
              </div>
              <div className="space-y-5">
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    By customer group
                  </h3>
                  <BarList
                    items={clientGroups.map((g) => ({
                      label: g.customer_group ?? "Ungrouped",
                      value: g.contacts,
                      display: `${fmtNumber(g.contacts)} · ${fmtCurrency(g.revenue_ytd)}`,
                      color: "#6366f1",
                    }))}
                  />
                </div>
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    By division
                  </h3>
                  <BarList
                    items={clientDivisions.map((g) => ({
                      label: g.division ?? "Unassigned",
                      value: g.revenue_ytd,
                      display: `${fmtCurrency(g.revenue_ytd)} · ${fmtNumber(g.contacts)} contacts`,
                      color: "#f59e0b",
                    }))}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Upload history */}
      <SectionCard
        title="Upload history"
        description="Every monthly invoice import, newest first."
      >
        <ImportHistory imports={imports} isAdmin={isAdmin} />
      </SectionCard>
    </div>
  );
}
