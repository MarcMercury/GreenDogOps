"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requireAdmin } from "@/lib/auth/session";
import { canEditModule, canAccessModule } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  InvoiceLineInput,
  StaffBreakdown,
  StaffProductRow,
  StaffProductGroupRow,
  AppointmentReviewRow,
  AppointmentReviewDetailRow,
  AppointmentReviewTypeRow,
  AppointmentReviewTypeDetailRow,
  CancelledApptTypeRow,
  CancelledApptDetailRow,
  BizDevLocation,
  BizDevApptTypeRow,
  BizDevOpenDays,
  BizDevWeekdayFactors,
  BizDevProviderCapacity,
  LocationKey,
} from "@/lib/reporting/types";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

async function requireReportingEditor() {
  const current = await requireUser();
  if (!canEditModule(current.appUser, "reporting")) {
    throw new Error("You do not have permission to import reporting data.");
  }
  return current;
}

async function requireReportingAccess() {
  const current = await requireUser();
  if (!canAccessModule(current.appUser, "reporting")) {
    throw new Error("You do not have access to reporting data.");
  }
  return current;
}

/**
 * Per-provider drill-down for the Doctors/Staff tab: top product groups and
 * top individual products (by revenue) for a single staff member.
 */
export async function getStaffBreakdown(
  staffMember: string,
  year?: number,
  byCaseOwner = false,
): Promise<StaffBreakdown> {
  await requireReportingAccess();
  if (!staffMember || typeof staffMember !== "string") {
    return { topGroups: [], topProducts: [] };
  }
  const supabase = await createClient();
  const groupView = byCaseOwner
    ? "report_case_owner_product_group"
    : "report_staff_product_group";
  const productView = byCaseOwner
    ? "report_case_owner_product"
    : "report_staff_product";
  let groupsQuery = supabase
    .from(groupView)
    .select("product_group, line_count, revenue")
    .eq("staff_member", staffMember);
  let productsQuery = supabase
    .from(productView)
    .select("product_name, product_group, line_count, qty, revenue")
    .eq("staff_member", staffMember);
  if (typeof year === "number" && Number.isFinite(year)) {
    groupsQuery = groupsQuery.eq("year", year);
    productsQuery = productsQuery.eq("year", year);
  }
  const [groupsRes, productsRes] = await Promise.all([
    groupsQuery.order("revenue", { ascending: false }).limit(8),
    productsQuery.order("revenue", { ascending: false }).limit(12),
  ]);
  return {
    topGroups: (groupsRes.data ?? []) as StaffProductGroupRow[],
    topProducts: (productsRes.data ?? []) as StaffProductRow[],
  };
}

/**
 * Appointment Review: for each past day in [startDate, endDate], the booked
 * (expected) vs rendered (actual) appointment counts per location / department,
 * derived from the dated ezyVet Agenda snapshots. The range is capped at 92
 * days and must be in the past.
 */
export async function getAppointmentReview(
  startDate: string,
  endDate: string,
): Promise<{ ok: true; rows: AppointmentReviewRow[] } | { ok: false; error: string }> {
  await requireReportingAccess();
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoRe.test(startDate) || !isoRe.test(endDate)) {
    return { ok: false, error: "Invalid date range." };
  }
  let start = startDate;
  let end = endDate;
  if (start > end) [start, end] = [end, start];
  const spanDays = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
  if (spanDays > 92) {
    return { ok: false, error: "Please choose a range of 92 days or fewer." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("appointment_review", {
    p_start: start,
    p_end: end,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as AppointmentReviewRow[] };
}

/**
 * Appointment Review drill-down: the individual appointments behind the
 * Cancelled/Moved (dropped) and Added On (added) counts for one location /
 * department across a past-date range, from the dated Agenda detail snapshots.
 */
export async function getAppointmentReviewDetail(
  locationId: string,
  departmentId: string,
  startDate: string,
  endDate: string,
): Promise<{ ok: true; rows: AppointmentReviewDetailRow[] } | { ok: false; error: string }> {
  await requireReportingAccess();
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(locationId) || !uuidRe.test(departmentId)) {
    return { ok: false, error: "Invalid selection." };
  }
  if (!isoRe.test(startDate) || !isoRe.test(endDate)) {
    return { ok: false, error: "Invalid date range." };
  }
  let start = startDate;
  let end = endDate;
  if (start > end) [start, end] = [end, start];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("appointment_review_detail", {
    p_location: locationId,
    p_department: departmentId,
    p_start: start,
    p_end: end,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as AppointmentReviewDetailRow[] };
}

/**
 * Appointment Review grouped by ezyVet appointment TYPE: scheduled vs rendered
 * (with the not-rendered gap) per appointment-type category across all
 * locations for a past-date range. Range is capped at 92 days.
 */
export async function getAppointmentReviewByType(
  startDate: string,
  endDate: string,
): Promise<{ ok: true; rows: AppointmentReviewTypeRow[] } | { ok: false; error: string }> {
  await requireReportingAccess();
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoRe.test(startDate) || !isoRe.test(endDate)) {
    return { ok: false, error: "Invalid date range." };
  }
  let start = startDate;
  let end = endDate;
  if (start > end) [start, end] = [end, start];
  const spanDays = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
  if (spanDays > 92) {
    return { ok: false, error: "Please choose a range of 92 days or fewer." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("appointment_review_by_type", {
    p_start: start,
    p_end: end,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as AppointmentReviewTypeRow[] };
}

/**
 * Appointment Review by-type drill-down: the individual appointments of a given
 * appointment type that were NOT rendered (cancelled / moved) across all
 * locations for a past-date range.
 */
export async function getAppointmentReviewTypeDetail(
  locationId: string,
  startDate: string,
  endDate: string,
  apptType: string,
): Promise<{ ok: true; rows: AppointmentReviewTypeDetailRow[] } | { ok: false; error: string }> {
  await requireReportingAccess();
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(locationId)) {
    return { ok: false, error: "Invalid location." };
  }
  if (!isoRe.test(startDate) || !isoRe.test(endDate)) {
    return { ok: false, error: "Invalid date range." };
  }
  if (!apptType || apptType.length > 200) {
    return { ok: false, error: "Invalid appointment type." };
  }
  let start = startDate;
  let end = endDate;
  if (start > end) [start, end] = [end, start];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("appointment_review_type_detail", {
    p_location: locationId,
    p_start: start,
    p_end: end,
    p_type: apptType,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as AppointmentReviewTypeDetailRow[] };
}

/**
 * Cancels by appointment type: how many appointments of each type were
 * cancelled across all locations for a past-date range, from the ezyVet
 * "Canceled Appointments" report. Range capped at 92 days.
 */
export async function getCancelledAppointmentsByType(
  startDate: string,
  endDate: string,
): Promise<{ ok: true; rows: CancelledApptTypeRow[] } | { ok: false; error: string }> {
  await requireReportingAccess();
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoRe.test(startDate) || !isoRe.test(endDate)) {
    return { ok: false, error: "Invalid date range." };
  }
  let start = startDate;
  let end = endDate;
  if (start > end) [start, end] = [end, start];
  const spanDays = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
  if (spanDays > 92) {
    return { ok: false, error: "Please choose a range of 92 days or fewer." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancelled_appointments_by_type", {
    p_start: start,
    p_end: end,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as CancelledApptTypeRow[] };
}

/**
 * Cancels drill-down: the individual cancelled appointments of a given type
 * across all locations for a past-date range, with reason and description.
 */
export async function getCancelledAppointmentDetail(
  locationId: string,
  startDate: string,
  endDate: string,
  apptType: string,
): Promise<{ ok: true; rows: CancelledApptDetailRow[] } | { ok: false; error: string }> {
  await requireReportingAccess();
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(locationId)) {
    return { ok: false, error: "Invalid location." };
  }
  if (!isoRe.test(startDate) || !isoRe.test(endDate)) {
    return { ok: false, error: "Invalid date range." };
  }
  if (!apptType || apptType.length > 200) {
    return { ok: false, error: "Invalid appointment type." };
  }
  let start = startDate;
  let end = endDate;
  if (start > end) [start, end] = [end, start];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancelled_appointments_detail", {
    p_location: locationId,
    p_start: start,
    p_end: end,
    p_type: apptType,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as CancelledApptDetailRow[] };
}

/** Begin an invoice import session; returns the new import id. */
export async function createInvoiceImport(
  filename: string,
  label: string,
  totalRows: number,
): Promise<{ ok: true; importId: string } | { ok: false; error: string }> {
  const current = await requireReportingEditor();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ezyvet_invoice_import")
    .insert({
      filename,
      label,
      uploaded_by: current.authId,
      total_rows: totalRows,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to start import." };
  return { ok: true, importId: data.id as string };
}

/**
 * Upsert a batch of invoice lines (deduped on invoice_line_id). Returns how
 * many rows were newly inserted vs. already on file (updated in place).
 */
export async function pushInvoiceLines(
  importId: string,
  rows: InvoiceLineInput[],
): Promise<{ ok: true; inserted: number } | { ok: false; error: string }> {
  await requireReportingEditor();
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, inserted: 0 };
  const admin = createAdminClient();

  const ids = rows.map((r) => r.invoice_line_id);
  const { data: existing } = await admin
    .from("ezyvet_invoice_line")
    .select("invoice_line_id")
    .in("invoice_line_id", ids);
  const existingSet = new Set((existing ?? []).map((e) => e.invoice_line_id as string));
  const inserted = rows.filter((r) => !existingSet.has(r.invoice_line_id)).length;

  const payload = rows.map((r) => ({ ...r, import_id: importId }));
  const { error } = await admin
    .from("ezyvet_invoice_line")
    .upsert(payload, { onConflict: "invoice_line_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, inserted };
}

/** Close out the import: compute date range, revenue and appointment count. */
export async function finalizeInvoiceImport(
  importId: string,
  newRows: number,
  skippedRows: number,
): Promise<ActionResult> {
  await requireReportingEditor();
  const admin = createAdminClient();

  // Pull just the keys needed to derive this import's stats.
  const { data: lines } = await admin
    .from("ezyvet_invoice_line")
    .select("line_date, total_incl, client_contact_code, location_key, product_name, product_group")
    .eq("import_id", importId);

  let revenue = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  // A (client + day + location) counts as an appointment only if at least one
  // of its lines is appointment-eligible — i.e. NOT a deposit/refund and NOT a
  // retail/OTC item. Mirrors greendogops.is_appt_line() in the DB roll-ups.
  const NON_APPT_GROUPS = new Set([
    "Retail",
    "Consumables, Food, and Supplements",
    "Supplies",
    "Parasite Control",
    "Medications - Rx",
    "Controlled Substances - Rx",
    "Green Dog Pet Plus Wellness Plan",
    "Follow Up",
    "Cremation Services",
    "Service Fee",
    "*Discount/Credit/Deposit",
  ]);
  const apptQualifies = new Map<string, boolean>();
  for (const l of lines ?? []) {
    const inc = Number(l.total_incl ?? 0);
    if (Number.isFinite(inc)) revenue += inc;
    const d = l.line_date as string | null;
    if (d) {
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
      if (l.client_contact_code) {
        const key = `${l.client_contact_code}|${d}|${l.location_key ?? ""}`;
        const name = (l.product_name ?? "").toLowerCase();
        const group = (l.product_group ?? "").trim();
        const isAppointmentLine =
          !name.includes("deposit") &&
          !name.includes("refund") &&
          !NON_APPT_GROUPS.has(group);
        apptQualifies.set(key, (apptQualifies.get(key) ?? false) || isAppointmentLine);
      }
    }
  }
  let appointmentCount = 0;
  for (const qualifies of apptQualifies.values()) if (qualifies) appointmentCount++;

  await admin
    .from("ezyvet_invoice_import")
    .update({
      new_rows: newRows,
      skipped_rows: skippedRows,
      revenue_total: Math.round(revenue * 100) / 100,
      appointment_count: appointmentCount,
      date_range_start: minDate,
      date_range_end: maxDate,
      details: { newRows, skippedRows, lines: lines?.length ?? 0 },
    })
    .eq("id", importId);

  // Request a server-side rebuild of every materialized reporting roll-up. This
  // returns instantly; a pg_cron worker performs the heavy (~3 min) refresh with
  // no API gateway in the path (migration 0094). Rebuilding synchronously here
  // over HTTP exceeds the gateway's ~150s limit ("upstream request timeout").
  const { error: refreshError } = await admin.rpc("request_reporting_refresh");
  if (refreshError) {
    return {
      ok: false,
      error: `Imported ${newRows.toLocaleString()} lines, but queuing the report refresh failed: ${refreshError.message}. Contact an admin to refresh.`,
    };
  }

  revalidatePath("/reporting");
  return {
    ok: true,
    message: `Imported ${newRows.toLocaleString()} new line${newRows === 1 ? "" : "s"} · ${appointmentCount.toLocaleString()} appointments · $${Math.round(revenue).toLocaleString()} revenue. Reports refresh within a minute.`,
  };
}

/** Delete a single prior invoice import and its lines (admin only). */
export async function deleteInvoiceImport(importId: string): Promise<ActionResult> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error: delLines } = await admin
    .from("ezyvet_invoice_line")
    .delete()
    .eq("import_id", importId);
  if (delLines) return { ok: false, error: delLines.message };
  const { error } = await admin
    .from("ezyvet_invoice_import")
    .delete()
    .eq("id", importId);
  if (error) return { ok: false, error: error.message };
  await admin.rpc("request_reporting_refresh");
  revalidatePath("/reporting");
  return { ok: true, message: "Import removed. Reports refresh within a minute." };
}

/**
 * Timestamp of the last completed server-side reporting refresh (migration
 * 0094 `reporting_refresh_state.completed_at`). The Reporting page polls this
 * so it can auto-refresh the UI once the pg_cron worker finishes rebuilding the
 * `report_*` matviews after an agent ingest — otherwise an open page shows
 * stale numbers until a manual reload. Returns null if no refresh has run yet.
 */
export async function getReportingRefreshedAt(): Promise<string | null> {
  await requireReportingAccess();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reporting_refresh_state")
    .select("completed_at")
    .eq("id", true)
    .maybeSingle();
  if (error) return null;
  return (data?.completed_at as string | null) ?? null;
}

/** Wipe ALL invoice-line reporting data (admin only, destructive). */
export async function resetInvoiceData(): Promise<ActionResult> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error: e1 } = await admin
    .from("ezyvet_invoice_line")
    .delete()
    .not("id", "is", null);
  if (e1) return { ok: false, error: e1.message };
  const { error: e2 } = await admin
    .from("ezyvet_invoice_import")
    .delete()
    .not("id", "is", null);
  if (e2) return { ok: false, error: e2.message };
  await admin.rpc("request_reporting_refresh");
  revalidatePath("/reporting");
  return { ok: true, message: "All invoice reporting data cleared. Reports refresh within a minute." };
}

// ---------------------------------------------------------------------------
// Business Development planner
// ---------------------------------------------------------------------------

/** Clinic `location.name` → reporting location key (blended-value lookup). */
const BIZDEV_NAME_TO_KEY: Record<string, LocationKey> = {
  "Sherman Oaks": "sherman_oaks",
  "Van Nuys": "van_nuys",
  Venice: "venice",
};

/** Order clinics consistently across the planner. */
const BIZDEV_LOCATION_ORDER: LocationKey[] = ["sherman_oaks", "van_nuys", "venice"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DailyAvgRow {
  location_id: string;
  appt_type: string;
  avg_per_day: number;
  days_observed: number;
  total_appts: number;
}

interface DerivedValueRow {
  location_id: string;
  appt_type: string;
  avg_value: number;
  matched_paid: number;
}

interface WeekdayFactorRow {
  location_id: string;
  dow: number;
  factor: number;
  n_days: number;
}

interface HourDemandRow {
  location_id: string;
  hour: number;
  avg_per_open_day: number | string;
}

interface BizDevApptTypeDbRow {
  id: string;
  location_id: string;
  appt_type: string;
  avg_value: number | string;
  avg_per_day: number | string;
  planned_per_day: number | string;
  planned_per_week: number | string;
  cadence: string;
  max_per_day: number | string;
  provider_role: string;
  per_provider_day: number | string;
  included: boolean;
  is_custom: boolean;
  sort_order: number;
}

/**
 * Load the Business Development planner: for each clinic, its open-days scenario
 * and one editable row per appointment type. Both base numbers come from REAL
 * data: the average value is recovered by bridging the Agenda to invoices
 * through the contact record; the average appointments/day is the realized
 * Agenda average. On first load, missing rows are seeded from that data (value
 * falls back to the clinic blended average when a type has no matched revenue).
 * Returns clinics in a fixed order.
 */
export async function getBusinessDevelopmentData(): Promise<BizDevLocation[]> {
  await requireReportingAccess();
  const admin = createAdminClient();

  // Clinics we plan for (active clinics with a reporting key).
  const { data: locData } = await admin
    .from("location")
    .select("id, name")
    .in("name", Object.keys(BIZDEV_NAME_TO_KEY));
  const locations = (locData ?? []) as { id: string; name: string }[];
  if (locations.length === 0) return [];

  // Blended average appointment value per clinic, from the latest report year.
  const { data: yearData } = await admin.from("report_years").select("year");
  const years = ((yearData ?? []) as { year: number }[]).map((r) => r.year);
  const latestYear = years.length ? Math.max(...years) : new Date().getFullYear();
  const { data: locRevData } = await admin
    .from("report_by_location")
    .select("location_key, avg_appointment_value")
    .eq("year", latestYear);
  const blendedByKey = new Map<string, number>();
  for (const r of (locRevData ?? []) as { location_key: string; avg_appointment_value: number | string }[]) {
    blendedByKey.set(r.location_key, Number(r.avg_appointment_value ?? 0));
  }

  // Current realized average appointments/day per (clinic, appointment type).
  const { data: avgData } = await admin.rpc("bizdev_appt_type_daily_avg");
  const dailyAvg = (avgData ?? []) as DailyAvgRow[];
  const avgByKey = new Map<string, DailyAvgRow>();
  for (const r of dailyAvg) avgByKey.set(`${r.location_id}|${r.appt_type}`, r);

  // REAL average revenue per (clinic, appointment type), derived by bridging
  // the Agenda to invoices through the contact record.
  const { data: valueData } = await admin.rpc("bizdev_appt_type_value");
  const derivedValues = (valueData ?? []) as DerivedValueRow[];
  const valueByKey = new Map<string, DerivedValueRow>();
  for (const r of derivedValues) valueByKey.set(`${r.location_id}|${r.appt_type}`, r);

  // Day-of-week volume factors (realized revenue ratio vs a typical weekday).
  const { data: factorData } = await admin.rpc("bizdev_weekday_factor");
  const factorRows = (factorData ?? []) as WeekdayFactorRow[];
  const factorByLocDow = new Map<string, WeekdayFactorRow>();
  for (const r of factorRows) factorByLocDow.set(`${r.location_id}|${r.dow}`, r);

  // Realized hourly demand curve per clinic (booked appts by hour-of-day).
  const { data: hourData } = await admin.rpc("bizdev_hour_demand");
  const hourRows = (hourData ?? []) as HourDemandRow[];
  const hourByLoc = new Map<string, { hour: number; avg_per_open_day: number }[]>();
  for (const r of hourRows) {
    const list = hourByLoc.get(r.location_id) ?? [];
    list.push({ hour: r.hour, avg_per_open_day: Number(r.avg_per_open_day ?? 0) });
    hourByLoc.set(r.location_id, list);
  }
  for (const list of hourByLoc.values()) list.sort((a, b) => a.hour - b.hour);

  // Pooled (all-clinic) average value per appointment type, weighted by matched
  // sample size. Used as the fallback when a clinic has no matched revenue for a
  // type — far more meaningful than the clinic's blended average (e.g. give
  // Sherman Oaks' Advanced Procedure the Van Nuys/Venice value, not $403).
  const pooledNum = new Map<string, number>();
  const pooledDen = new Map<string, number>();
  for (const r of derivedValues) {
    const n = Number(r.matched_paid ?? 0);
    if (n <= 0) continue;
    pooledNum.set(r.appt_type, (pooledNum.get(r.appt_type) ?? 0) + Number(r.avg_value ?? 0) * n);
    pooledDen.set(r.appt_type, (pooledDen.get(r.appt_type) ?? 0) + n);
  }
  const pooledValue = (apptType: string): number | null => {
    const den = pooledDen.get(apptType);
    if (!den) return null;
    return (pooledNum.get(apptType) ?? 0) / den;
  };

  const locationIds = locations.map((l) => l.id);

  // Existing planner rows.
  const { data: existingData } = await admin
    .from("bizdev_appt_type")
    .select("id, location_id, appt_type, avg_value, avg_per_day, planned_per_day, planned_per_week, cadence, max_per_day, provider_role, per_provider_day, included, is_custom, sort_order")
    .in("location_id", locationIds);
  const existing = (existingData ?? []) as BizDevApptTypeDbRow[];
  const existingKeys = new Set(existing.map((r) => `${r.location_id}|${r.appt_type}`));

  // Full catalog of appointment types seen ANYWHERE (across all clinics), so the
  // planner can offer every service at every clinic — a clinic that doesn't yet
  // render a type still gets a row it can toggle ON to model adding that service.
  const allApptTypes = new Set<string>();
  for (const r of dailyAvg) allApptTypes.add(r.appt_type);
  for (const r of derivedValues) allApptTypes.add(r.appt_type);
  for (const r of existing) allApptTypes.add(r.appt_type);

  // Seed every (clinic × type) pair that has no row yet. A type the clinic
  // ALREADY renders (has realized Agenda volume) seeds as included with its real
  // average; a type it doesn't render seeds OFF with 0 volume and the pooled
  // all-clinic value, ready to toggle on.
  const seeds: {
    location_id: string;
    appt_type: string;
    avg_value: number;
    avg_per_day: number;
    planned_per_day: number;
    included: boolean;
    sort_order: number;
    provider_role: string;
  }[] = [];
  for (const locationId of locationIds) {
    for (const apptType of allApptTypes) {
      if (existingKeys.has(`${locationId}|${apptType}`)) continue;
      const realized = avgByKey.get(`${locationId}|${apptType}`);
      const derived = valueByKey.get(`${locationId}|${apptType}`);
      // Real per-clinic value if we recovered any paid appointment there, else
      // the pooled all-clinic value for that type, else 0 (never yet invoiced).
      const value = derived
        ? Number(derived.avg_value ?? 0)
        : (pooledValue(apptType) ?? 0);
      const perDay = realized
        ? Math.round(Number(realized.avg_per_day ?? 0) * 100) / 100
        : 0;
      seeds.push({
        location_id: locationId,
        appt_type: apptType,
        avg_value: Math.round(value * 100) / 100,
        avg_per_day: perDay,
        planned_per_day: Math.round(perDay),
        // Types the clinic actually renders start ON; catalog-only types start OFF.
        included: !!realized,
        // Rendered types sort by volume first; catalog-only types sink below them.
        sort_order: realized
          ? 1000 - Math.min(999, Number(realized.total_appts ?? 0))
          : 2000,
        // Obvious default: tech-named services are tech-rendered, else doctor.
        provider_role: /tech/i.test(apptType) ? "tech" : "dvm",
      });
    }
  }
  if (seeds.length > 0) {
    await admin
      .from("bizdev_appt_type")
      .upsert(seeds, { onConflict: "location_id,appt_type", ignoreDuplicates: true });
  }

  // Ensure every clinic has a config row (open days + weekday factors + provider
  // capacity). Default Mon–Sat, factors 1.0, no providers configured.
  const CFG_COLS =
    "location_id, open_sun, open_mon, open_tue, open_wed, open_thu, open_fri, open_sat, " +
    "factor_sun, factor_mon, factor_tue, factor_wed, factor_thu, factor_fri, factor_sat, " +
    "dvm_count, appts_per_dvm_day, added_dvms, tech_count, added_techs";
  interface CfgDbRow extends BizDevOpenDays {
    location_id: string;
    factor_sun: number | string;
    factor_mon: number | string;
    factor_tue: number | string;
    factor_wed: number | string;
    factor_thu: number | string;
    factor_fri: number | string;
    factor_sat: number | string;
    dvm_count: number | string;
    appts_per_dvm_day: number | string;
    added_dvms: number | string;
    tech_count: number | string;
    added_techs: number | string;
  }
  const { data: cfgData } = await admin
    .from("bizdev_location_config")
    .select(CFG_COLS)
    .in("location_id", locationIds);
  let cfgRows = (cfgData ?? []) as unknown as CfgDbRow[];
  const cfgById = new Map<string, CfgDbRow>();
  for (const c of cfgRows) cfgById.set(c.location_id, c);

  const missingCfg = locationIds
    .filter((id) => !cfgById.has(id))
    .map((id) => ({ location_id: id }));
  if (missingCfg.length > 0) {
    await admin
      .from("bizdev_location_config")
      .upsert(missingCfg, { onConflict: "location_id", ignoreDuplicates: true });
  }

  // Seed real day-of-week factors into any config still at all-default (1.0).
  // Sunday's realized data is unreliable (clinic closed → near-zero stragglers),
  // so a new-Sunday scenario borrows Saturday's weekend factor. Days with a thin
  // sample fall back to 1.0. Only seeds once — user edits are preserved.
  const DOW_TO_COL = ["factor_sun", "factor_mon", "factor_tue", "factor_wed", "factor_thu", "factor_fri", "factor_sat"] as const;
  const factorSeeds: Record<string, number | string>[] = [];
  for (const id of locationIds) {
    const c = cfgById.get(id);
    const allDefault =
      !c ||
      DOW_TO_COL.every((col) => Number(c[col] ?? 1) === 1);
    if (!allDefault) continue;
    const satRow = factorByLocDow.get(`${id}|6`);
    const satFactor = satRow && satRow.n_days >= 15 ? Number(satRow.factor) : null;
    const patch: Record<string, number | string> = { location_id: id, updated_at: new Date().toISOString() };
    for (let dow = 0; dow < 7; dow++) {
      const row = factorByLocDow.get(`${id}|${dow}`);
      let f = 1;
      if (dow === 0) {
        // Sunday: use its own factor only if it looks like a real open day.
        f = row && row.n_days >= 15 && Number(row.factor) >= 0.2
          ? Number(row.factor)
          : (satFactor ?? 1);
      } else if (row && row.n_days >= 15) {
        f = Number(row.factor);
      }
      patch[DOW_TO_COL[dow]] = Math.round(f * 1000) / 1000;
    }
    factorSeeds.push(patch);
  }
  if (factorSeeds.length > 0) {
    await admin
      .from("bizdev_location_config")
      .upsert(factorSeeds, { onConflict: "location_id" });
    // Re-read so the seeded factors flow into the response.
    const { data: reCfg } = await admin
      .from("bizdev_location_config")
      .select(CFG_COLS)
      .in("location_id", locationIds);
    cfgRows = (reCfg ?? cfgData ?? []) as unknown as CfgDbRow[];
    cfgById.clear();
    for (const c of cfgRows) cfgById.set(c.location_id, c);
  }

  const defaultDays: BizDevOpenDays = {
    open_sun: false,
    open_mon: true,
    open_tue: true,
    open_wed: true,
    open_thu: true,
    open_fri: true,
    open_sat: true,
  };
  const openDaysFrom = (c: CfgDbRow | undefined): BizDevOpenDays =>
    c
      ? {
          open_sun: c.open_sun,
          open_mon: c.open_mon,
          open_tue: c.open_tue,
          open_wed: c.open_wed,
          open_thu: c.open_thu,
          open_fri: c.open_fri,
          open_sat: c.open_sat,
        }
      : defaultDays;
  const factorsFrom = (c: CfgDbRow | undefined): BizDevWeekdayFactors => ({
    factor_sun: Number(c?.factor_sun ?? 1),
    factor_mon: Number(c?.factor_mon ?? 1),
    factor_tue: Number(c?.factor_tue ?? 1),
    factor_wed: Number(c?.factor_wed ?? 1),
    factor_thu: Number(c?.factor_thu ?? 1),
    factor_fri: Number(c?.factor_fri ?? 1),
    factor_sat: Number(c?.factor_sat ?? 1),
  });
  const providerFrom = (c: CfgDbRow | undefined): BizDevProviderCapacity => ({
    dvm_count: Number(c?.dvm_count ?? 0),
    appts_per_dvm_day: Number(c?.appts_per_dvm_day ?? 0),
    added_dvms: Number(c?.added_dvms ?? 0),
    tech_count: Number(c?.tech_count ?? 0),
    added_techs: Number(c?.added_techs ?? 0),
  });

  // Re-read the (now seeded) planner rows.
  const { data: allRowsData } = await admin
    .from("bizdev_appt_type")
    .select("id, location_id, appt_type, avg_value, avg_per_day, planned_per_day, planned_per_week, cadence, max_per_day, provider_role, per_provider_day, included, is_custom, sort_order")
    .in("location_id", locationIds);
  const allRows = (allRowsData ?? []) as BizDevApptTypeDbRow[];

  const result: BizDevLocation[] = [];
  for (const loc of locations) {
    const key = BIZDEV_NAME_TO_KEY[loc.name];
    if (!key) continue;
    const rows = allRows
      .filter((r) => r.location_id === loc.id)
      .map<BizDevApptTypeRow>((r) => {
        const avg = avgByKey.get(`${r.location_id}|${r.appt_type}`);
        const derived = valueByKey.get(`${r.location_id}|${r.appt_type}`);
        return {
          id: r.id,
          location_id: r.location_id,
          appt_type: r.appt_type,
          avg_value: Number(r.avg_value ?? 0),
          avg_per_day: Number(r.avg_per_day ?? 0),
          planned_per_day: Number(r.planned_per_day ?? 0),
          planned_per_week: Number(r.planned_per_week ?? 0),
          cadence: r.cadence === "weekly" ? "weekly" : "daily",
          max_per_day: Number(r.max_per_day ?? 0),
          provider_role:
            r.provider_role === "tech" || r.provider_role === "none"
              ? r.provider_role
              : "dvm",
          per_provider_day: Number(r.per_provider_day ?? 0),
          included: r.included,
          is_custom: r.is_custom,
          sort_order: r.sort_order,
          matched_paid: derived ? Number(derived.matched_paid ?? 0) : 0,
          days_observed: avg ? Number(avg.days_observed ?? 0) : 0,
        };
      })
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.appt_type.localeCompare(b.appt_type),
      );
    result.push({
      location_id: loc.id,
      location_key: key,
      location_label: loc.name,
      blended_avg_value: Math.round((blendedByKey.get(key) ?? 0) * 100) / 100,
      open_days: openDaysFrom(cfgById.get(loc.id)),
      weekday_factors: factorsFrom(cfgById.get(loc.id)),
      provider: providerFrom(cfgById.get(loc.id)),
      hour_demand: hourByLoc.get(loc.id) ?? [],
      types: rows,
    });
  }

  result.sort(
    (a, b) =>
      BIZDEV_LOCATION_ORDER.indexOf(a.location_key) -
      BIZDEV_LOCATION_ORDER.indexOf(b.location_key),
  );
  return result;
}

/** Update one planner row's base value / avg-per-day / planned count / included. */
export async function updateBizDevApptType(
  id: string,
  patch: {
    avg_value?: number;
    avg_per_day?: number;
    planned_per_day?: number;
    planned_per_week?: number;
    cadence?: "daily" | "weekly";
    max_per_day?: number;
    provider_role?: "dvm" | "tech" | "none";
    per_provider_day?: number;
    included?: boolean;
  },
): Promise<ActionResult> {
  await requireReportingEditor();
  if (!UUID_RE.test(id)) return { ok: false, error: "Invalid row." };
  const update: Record<string, number | boolean | string> = { updated_at: new Date().toISOString() };
  if (typeof patch.avg_value === "number" && Number.isFinite(patch.avg_value)) {
    update.avg_value = Math.max(0, Math.round(patch.avg_value * 100) / 100);
  }
  if (typeof patch.avg_per_day === "number" && Number.isFinite(patch.avg_per_day)) {
    update.avg_per_day = Math.max(0, Math.round(patch.avg_per_day * 100) / 100);
  }
  if (typeof patch.planned_per_day === "number" && Number.isFinite(patch.planned_per_day)) {
    update.planned_per_day = Math.max(0, Math.round(patch.planned_per_day * 100) / 100);
  }
  if (typeof patch.planned_per_week === "number" && Number.isFinite(patch.planned_per_week)) {
    update.planned_per_week = Math.max(0, Math.round(patch.planned_per_week * 100) / 100);
  }
  if (patch.cadence === "daily" || patch.cadence === "weekly") {
    update.cadence = patch.cadence;
  }
  if (typeof patch.max_per_day === "number" && Number.isFinite(patch.max_per_day)) {
    update.max_per_day = Math.max(0, Math.round(patch.max_per_day * 100) / 100);
  }
  if (patch.provider_role === "dvm" || patch.provider_role === "tech" || patch.provider_role === "none") {
    update.provider_role = patch.provider_role;
  }
  if (typeof patch.per_provider_day === "number" && Number.isFinite(patch.per_provider_day)) {
    update.per_provider_day = Math.max(0, Math.round(patch.per_provider_day * 100) / 100);
  }
  if (typeof patch.included === "boolean") update.included = patch.included;
  const admin = createAdminClient();
  const { error } = await admin.from("bizdev_appt_type").update(update).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Saved." };
}

/** Save which weekdays a clinic is open. */
export async function saveBizDevOpenDays(
  locationId: string,
  days: BizDevOpenDays,
): Promise<ActionResult> {
  await requireReportingEditor();
  if (!UUID_RE.test(locationId)) return { ok: false, error: "Invalid clinic." };
  const admin = createAdminClient();
  const { error } = await admin.from("bizdev_location_config").upsert(
    {
      location_id: locationId,
      open_sun: !!days.open_sun,
      open_mon: !!days.open_mon,
      open_tue: !!days.open_tue,
      open_wed: !!days.open_wed,
      open_thu: !!days.open_thu,
      open_fri: !!days.open_fri,
      open_sat: !!days.open_sat,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "location_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Saved." };
}

/** Save a clinic's day-of-week volume factors. */
export async function saveBizDevWeekdayFactors(
  locationId: string,
  factors: BizDevWeekdayFactors,
): Promise<ActionResult> {
  await requireReportingEditor();
  if (!UUID_RE.test(locationId)) return { ok: false, error: "Invalid clinic." };
  const clamp = (n: number) => Math.max(0, Math.round((Number.isFinite(n) ? n : 1) * 1000) / 1000);
  const admin = createAdminClient();
  const { error } = await admin.from("bizdev_location_config").upsert(
    {
      location_id: locationId,
      factor_sun: clamp(factors.factor_sun),
      factor_mon: clamp(factors.factor_mon),
      factor_tue: clamp(factors.factor_tue),
      factor_wed: clamp(factors.factor_wed),
      factor_thu: clamp(factors.factor_thu),
      factor_fri: clamp(factors.factor_fri),
      factor_sat: clamp(factors.factor_sat),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "location_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Saved." };
}

/** Save a clinic's provider-capacity scenario. */
export async function saveBizDevProviderCapacity(
  locationId: string,
  provider: BizDevProviderCapacity,
): Promise<ActionResult> {
  await requireReportingEditor();
  if (!UUID_RE.test(locationId)) return { ok: false, error: "Invalid clinic." };
  const clamp = (n: number) => Math.max(0, Math.round((Number.isFinite(n) ? n : 0) * 100) / 100);
  const admin = createAdminClient();
  const { error } = await admin.from("bizdev_location_config").upsert(
    {
      location_id: locationId,
      dvm_count: clamp(provider.dvm_count),
      appts_per_dvm_day: clamp(provider.appts_per_dvm_day),
      added_dvms: clamp(provider.added_dvms),
      tech_count: clamp(provider.tech_count),
      added_techs: clamp(provider.added_techs),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "location_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Saved." };
}

/** Add a custom appointment type to a clinic's planner. */
export async function addBizDevApptType(
  locationId: string,
  apptType: string,
  avgValue: number,
): Promise<{ ok: true; row: BizDevApptTypeRow } | { ok: false; error: string }> {
  await requireReportingEditor();
  if (!UUID_RE.test(locationId)) return { ok: false, error: "Invalid clinic." };
  const name = (apptType ?? "").trim();
  if (!name) return { ok: false, error: "Enter an appointment type name." };
  const value = Number.isFinite(avgValue) ? Math.max(0, Math.round(avgValue * 100) / 100) : 0;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bizdev_appt_type")
    .insert({
      location_id: locationId,
      appt_type: name,
      avg_value: value,
      avg_per_day: 0,
      planned_per_day: 0,
      included: true,
      is_custom: true,
      sort_order: 900,
      provider_role: /tech/i.test(name) ? "tech" : "dvm",
    })
    .select("id, location_id, appt_type, avg_value, avg_per_day, planned_per_day, planned_per_week, cadence, max_per_day, provider_role, per_provider_day, included, is_custom, sort_order")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That appointment type already exists here." };
    return { ok: false, error: error.message };
  }
  const r = data as BizDevApptTypeDbRow;
  return {
    ok: true,
    row: {
      id: r.id,
      location_id: r.location_id,
      appt_type: r.appt_type,
      avg_value: Number(r.avg_value ?? 0),
      avg_per_day: Number(r.avg_per_day ?? 0),
      planned_per_day: Number(r.planned_per_day ?? 0),
      planned_per_week: Number(r.planned_per_week ?? 0),
      cadence: r.cadence === "weekly" ? "weekly" : "daily",
      max_per_day: Number(r.max_per_day ?? 0),
      provider_role:
        r.provider_role === "tech" || r.provider_role === "none"
          ? r.provider_role
          : "dvm",
      per_provider_day: Number(r.per_provider_day ?? 0),
      included: r.included,
      is_custom: r.is_custom,
      sort_order: r.sort_order,
      matched_paid: 0,
      days_observed: 0,
    },
  };
}

/** Remove a user-added appointment type row (custom rows only). */
export async function deleteBizDevApptType(id: string): Promise<ActionResult> {
  await requireReportingEditor();
  if (!UUID_RE.test(id)) return { ok: false, error: "Invalid row." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("bizdev_appt_type")
    .delete()
    .eq("id", id)
    .eq("is_custom", true);
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Removed." };
}
