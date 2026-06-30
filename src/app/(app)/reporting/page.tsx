import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  isAdminRole,
  canEditModule,
  canAccessModule,
} from "@/lib/auth/permissions";
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
  InvoiceImportRow,
} from "@/lib/reporting/types";
import { PageHeader } from "../_components/ui";
import { SectionCard, fmtNumber, fmtDate } from "./charts";
import { InvoiceUploader } from "./invoice-uploader";
import { ImportHistory } from "./import-history";
import { ReportingTabs } from "./reporting-tabs";

export const dynamic = "force-dynamic";

export default async function ReportingPage() {
  const current = await getCurrentUser();

  // Biz Dev / Reporting is admin-only by default. Block direct navigation by
  // anyone who doesn't have the module (nav hiding alone is not enough).
  if (!current || !canAccessModule(current.appUser, "reporting")) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Business Intelligence"
          title="Reporting"
          description="Business development analytics."
        />
        <SectionCard
          title="Admin access required"
          description="The Reporting workspace is limited to administrators."
        >
          <p className="text-sm text-slate-500">
            You don&apos;t have access to this page. If you believe you should,
            ask an administrator to grant you the Reporting module.
          </p>
        </SectionCard>
      </div>
    );
  }

  const supabase = await createClient();
  const isAdmin = isAdminRole(current.appUser.role);
  const canEdit = canEditModule(current.appUser, "reporting");

  const [
    overviewRes,
    monthlyRes,
    locationRes,
    locationMonthlyRes,
    speciesRes,
    productRes,
    topProductRes,
    productByLocationRes,
    staffRes,
    staffByLocationRes,
    clientSummaryRes,
    clientsByMonthRes,
    clientGroupRes,
    clientDivisionRes,
    importsRes,
  ] = await Promise.all([
    supabase.from("report_overview").select("*").maybeSingle(),
    supabase.from("report_monthly").select("*"),
    supabase.from("report_by_location").select("*"),
    supabase.from("report_location_monthly").select("*"),
    supabase.from("report_by_species").select("*"),
    supabase.from("report_top_product_group").select("*").limit(12),
    supabase.from("report_top_product").select("*").limit(20),
    supabase.from("report_product_by_location").select("*"),
    supabase.from("report_by_staff").select("*").limit(100),
    supabase.from("report_staff_by_location").select("*"),
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
  const locationMonthly = (locationMonthlyRes.data ?? []) as LocationMonthlyRow[];
  const species = (speciesRes.data ?? []) as SpeciesRow[];
  const products = (productRes.data ?? []) as ProductGroupRow[];
  const topProducts = (topProductRes.data ?? []) as TopProductRow[];
  const productByLocation = (productByLocationRes.data ?? []) as ProductLocationRow[];
  const staff = (staffRes.data ?? []) as StaffRow[];
  const staffByLocation = (staffByLocationRes.data ?? []) as StaffLocationRow[];
  const clientSummary = (clientSummaryRes.data as ClientSummary | null) ?? null;
  const clientsByMonth = (clientsByMonthRes.data ?? []) as ClientsByMonthRow[];
  const clientGroups = (clientGroupRes.data ?? []) as ClientGroupRow[];
  const clientDivisions = (clientDivisionRes.data ?? []) as ClientGroupRow[];
  const imports = (importsRes.data ?? []) as InvoiceImportRow[];

  const hasInvoiceData = (overview?.total_lines ?? 0) > 0;
  const hasClientData = (clientSummary?.total_contacts ?? 0) > 0;

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
          {overview?.first_date ? (
            <p className="text-xs text-slate-500">
              Showing {fmtDate(overview.first_date)} – {fmtDate(overview.last_date)} ·{" "}
              {fmtNumber(overview.total_lines)} invoice lines
            </p>
          ) : null}

          <ReportingTabs
            overview={overview}
            monthly={monthly}
            locations={locations}
            locationMonthly={locationMonthly}
            species={species}
            products={products}
            topProducts={topProducts}
            productByLocation={productByLocation}
            staff={staff}
            staffByLocation={staffByLocation}
            clientSummary={clientSummary}
            clientsByMonth={clientsByMonth}
            clientGroups={clientGroups}
            clientDivisions={clientDivisions}
            hasClientData={hasClientData}
          />
        </>
      )}

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
