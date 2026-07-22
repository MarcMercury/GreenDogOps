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
  startDate: string,
  endDate: string,
  apptType: string,
): Promise<{ ok: true; rows: AppointmentReviewTypeDetailRow[] } | { ok: false; error: string }> {
  await requireReportingAccess();
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
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
  startDate: string,
  endDate: string,
  apptType: string,
): Promise<{ ok: true; rows: CancelledApptDetailRow[] } | { ok: false; error: string }> {
  await requireReportingAccess();
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
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
