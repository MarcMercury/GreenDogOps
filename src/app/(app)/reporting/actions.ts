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
): Promise<StaffBreakdown> {
  await requireReportingAccess();
  if (!staffMember || typeof staffMember !== "string") {
    return { topGroups: [], topProducts: [] };
  }
  const supabase = await createClient();
  let groupsQuery = supabase
    .from("report_staff_product_group")
    .select("product_group, line_count, revenue")
    .eq("staff_member", staffMember);
  let productsQuery = supabase
    .from("report_staff_product")
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
    .select("line_date, total_incl, client_contact_code, location_key, product_name")
    .eq("import_id", importId);

  let revenue = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  // A (client + day + location) counts as an appointment only if at least one
  // of its lines is NOT a deposit/refund. Track whether each key ever saw a
  // qualifying (non deposit/refund) line.
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
        const isDepositOrRefund =
          name.includes("deposit") || name.includes("refund");
        apptQualifies.set(key, (apptQualifies.get(key) ?? false) || !isDepositOrRefund);
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

  // Rebuild the materialized reporting roll-ups so the page reflects this import.
  await admin.rpc("refresh_ezyvet_reporting");

  revalidatePath("/reporting");
  return {
    ok: true,
    message: `Imported ${newRows.toLocaleString()} new line${newRows === 1 ? "" : "s"} · ${appointmentCount.toLocaleString()} appointments · $${Math.round(revenue).toLocaleString()} revenue.`,
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
  await admin.rpc("refresh_ezyvet_reporting");
  revalidatePath("/reporting");
  return { ok: true, message: "Import removed." };
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
  await admin.rpc("refresh_ezyvet_reporting");
  revalidatePath("/reporting");
  return { ok: true, message: "All invoice reporting data cleared." };
}
