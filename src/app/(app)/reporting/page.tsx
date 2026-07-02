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
  CaseOwnerMonthRow,
  ClientSummary,
  ClientsByMonthRow,
  ClientRecencyRow,
  ClientRecencyLocationRow,
  SpeciesPatientsRow,
  SpeciesRecencyRow,
  InvoiceImportRow,
} from "@/lib/reporting/types";
import { PageHeader } from "../_components/ui";
import { SectionCard, fmtNumber, fmtDate } from "./charts";
import { InvoiceUploader } from "./invoice-uploader";
import { ReportingTabs } from "./reporting-tabs";
import { YearToggle } from "./year-toggle";

export const dynamic = "force-dynamic";

export default async function ReportingPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
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

  // Available years (newest first) drive the toggle. The selected year filters
  // every invoice-derived view; client/CRM views are a current snapshot and
  // stay un-scoped. Defaults to the latest year with data.
  const { year: yearParam } = await searchParams;
  const yearsRes = await supabase.from("report_years").select("year");
  const years = ((yearsRes.data ?? []) as { year: number }[])
    .map((r) => r.year)
    .sort((a, b) => b - a);
  const requestedYear = yearParam ? Number(yearParam) : NaN;
  const selectedYear =
    Number.isFinite(requestedYear) && years.includes(requestedYear)
      ? requestedYear
      : (years[0] ?? new Date().getFullYear());

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
    caseOwnersRes,
    staffByLocationRes,
    caseOwnerByMonthRes,
    clientSummaryRes,
    clientsByMonthRes,
    clientRecencyRes,
    clientRecencyLocationRes,
    speciesPatientsRes,
    speciesRecencyRes,
    importsRes,
  ] = await Promise.all([
    supabase.from("report_overview").select("*").eq("year", selectedYear).maybeSingle(),
    supabase.from("report_monthly").select("*").eq("year", selectedYear),
    supabase.from("report_by_location").select("*").eq("year", selectedYear),
    supabase.from("report_location_monthly").select("*").eq("year", selectedYear),
    supabase.from("report_by_species").select("*").eq("year", selectedYear),
    supabase
      .from("report_top_product_group")
      .select("*")
      .eq("year", selectedYear)
      .order("revenue", { ascending: false, nullsFirst: false })
      .order("line_count", { ascending: false })
      .limit(12),
    supabase
      .from("report_top_product")
      .select("*")
      .eq("year", selectedYear)
      .order("revenue", { ascending: false, nullsFirst: false })
      .order("line_count", { ascending: false })
      .limit(20),
    supabase.from("report_product_by_location").select("*").eq("year", selectedYear),
    supabase.from("report_by_staff").select("*").eq("year", selectedYear).limit(100),
    supabase.from("report_by_case_owner").select("*").eq("year", selectedYear).limit(100),
    supabase.from("report_staff_by_location").select("*").eq("year", selectedYear),
    supabase
      .from("report_case_owner_by_month")
      .select("*")
      .eq("year", selectedYear)
      .order("month", { ascending: true }),
    supabase.from("report_client_summary").select("*").maybeSingle(),
    supabase.from("report_clients_by_month").select("*"),
    supabase.from("report_clients_by_recency").select("*"),
    supabase.from("report_clients_by_recency_location").select("*"),
    supabase.from("report_patients_by_species").select("*"),
    supabase.from("report_species_by_recency").select("*"),
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
  const caseOwners = (caseOwnersRes.data ?? []) as StaffRow[];
  const staffByLocation = (staffByLocationRes.data ?? []) as StaffLocationRow[];
  const caseOwnerByMonth = (caseOwnerByMonthRes.data ?? []) as CaseOwnerMonthRow[];
  const clientSummary = (clientSummaryRes.data as ClientSummary | null) ?? null;
  const clientsByMonth = (clientsByMonthRes.data ?? []) as ClientsByMonthRow[];
  const clientRecency = (clientRecencyRes.data ?? []) as ClientRecencyRow[];
  const clientRecencyLocation = (clientRecencyLocationRes.data ?? []) as ClientRecencyLocationRow[];
  const speciesPatients = (speciesPatientsRes.data ?? []) as SpeciesPatientsRow[];
  const speciesRecency = (speciesRecencyRes.data ?? []) as SpeciesRecencyRow[];
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
            is rolled up into a single appointment. Days whose only lines are a
            Deposit or Refund are not counted as appointments. Once you upload,
            this page fills with appointment volume, revenue trends, and a
            breakdown by location and species.
          </p>
        </SectionCard>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {overview?.first_date ? (
              <p className="text-xs text-slate-500">
                Showing {fmtDate(overview.first_date)} – {fmtDate(overview.last_date)} ·{" "}
                {fmtNumber(overview.total_lines)} invoice lines
              </p>
            ) : (
              <span />
            )}
            <YearToggle years={years} selected={selectedYear} />
          </div>

          <ReportingTabs
            year={selectedYear}
            overview={overview}
            monthly={monthly}
            locations={locations}
            locationMonthly={locationMonthly}
            species={species}
            products={products}
            topProducts={topProducts}
            productByLocation={productByLocation}
            staff={staff}
            caseOwners={caseOwners}
            staffByLocation={staffByLocation}
            caseOwnerByMonth={caseOwnerByMonth}
            clientSummary={clientSummary}
            clientsByMonth={clientsByMonth}
            clientRecency={clientRecency}
            clientRecencyLocation={clientRecencyLocation}
            speciesPatients={speciesPatients}
            speciesRecency={speciesRecency}
            hasClientData={hasClientData}
            imports={imports}
            isAdmin={isAdmin}
          />
        </>
      )}
    </div>
  );
}
