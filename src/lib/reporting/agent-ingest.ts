import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseInvoiceCsv, parseContactCsv } from "./parse";

export interface CsvIngestResult {
  ok: boolean;
  error?: string;
  importId?: string;
  parsed: number;
  inserted: number;
  updated?: number;
  skipped: number;
}

/**
 * Ingest an ezyVet "Invoice Lines" CSV export (raw text) using the service-role
 * client — the path the off-Vercel agent worker uses (no interactive user).
 * Mirrors the UI uploader: parse → create import → chunked dedup upsert →
 * refresh the materialized reporting roll-ups.
 */
export async function ingestInvoiceCsvText(
  text: string,
  meta: { filename?: string; label?: string } = {},
): Promise<CsvIngestResult> {
  const parsed = parseInvoiceCsv(text);
  if (parsed.error) {
    return { ok: false, error: parsed.error, parsed: 0, inserted: 0, skipped: 0 };
  }
  const rows = parsed.rows;
  const admin = createAdminClient();

  const { data: imp, error: impErr } = await admin
    .from("ezyvet_invoice_import")
    .insert({
      filename: meta.filename ?? "agent-invoice-lines.csv",
      label: meta.label ?? "Agent daily ingest",
      total_rows: rows.length,
    })
    .select("id")
    .single();
  if (impErr || !imp) {
    return { ok: false, error: impErr?.message ?? "Failed to open import.", parsed: rows.length, inserted: 0, skipped: parsed.skipped };
  }
  const importId = imp.id as string;

  // Count new vs. existing (chunked to stay under PostgREST max_rows), then upsert.
  const ids = rows.map((r) => r.invoice_line_id);
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const { data } = await admin
      .from("ezyvet_invoice_line")
      .select("invoice_line_id")
      .in("invoice_line_id", ids.slice(i, i + 1000));
    for (const e of data ?? []) existing.add(e.invoice_line_id as string);
  }
  const inserted = rows.filter((r) => !existing.has(r.invoice_line_id)).length;

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, import_id: importId }));
    const { error } = await admin
      .from("ezyvet_invoice_line")
      .upsert(chunk, { onConflict: "invoice_line_id" });
    if (error) {
      return { ok: false, error: error.message, importId, parsed: rows.length, inserted, skipped: parsed.skipped };
    }
  }

  // Record basic import stats + refresh the reporting matviews.
  const dates = rows.map((r) => r.line_date).filter(Boolean).sort() as string[];
  await admin
    .from("ezyvet_invoice_import")
    .update({
      new_rows: inserted,
      skipped_rows: parsed.skipped,
      date_range_start: dates[0] ?? null,
      date_range_end: dates[dates.length - 1] ?? null,
      details: { source: "agent", lines: rows.length },
    })
    .eq("id", importId);

  const { error: refreshErr } = await admin.rpc("refresh_ezyvet_reporting");
  if (refreshErr) {
    return { ok: false, error: `Imported ${inserted} lines but report refresh failed: ${refreshErr.message}`, importId, parsed: rows.length, inserted, skipped: parsed.skipped };
  }

  return { ok: true, importId, parsed: rows.length, inserted, skipped: parsed.skipped };
}

/**
 * Ingest an ezyVet "Contacts" CSV export (raw text) using the service-role
 * client. Upserts into ezyvet_contact (dedup on ezyvet_contact_id) and logs
 * created/updated/unchanged for client-growth trend reporting.
 */
export async function ingestContactCsvText(
  text: string,
  meta: { filename?: string; snapshotDate?: string | null } = {},
): Promise<CsvIngestResult> {
  const parsed = parseContactCsv(text);
  if (parsed.error) {
    return { ok: false, error: parsed.error, parsed: 0, inserted: 0, skipped: 0 };
  }
  const rows = parsed.rows;
  const admin = createAdminClient();

  const { data: imp, error: impErr } = await admin
    .from("ezyvet_contact_import")
    .insert({
      filename: meta.filename ?? "agent-contacts.csv",
      total_rows: rows.length,
      snapshot_date: meta.snapshotDate ?? null,
    })
    .select("id")
    .single();
  if (impErr || !imp) {
    return { ok: false, error: impErr?.message ?? "Failed to open import.", parsed: rows.length, inserted: 0, skipped: parsed.skipped };
  }
  const importId = imp.id as string;

  // Classify created/updated/unchanged via ezyVet modified-at (chunked lookup).
  const ids = rows.map((r) => r.ezyvet_contact_id);
  const prev = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 1000) {
    const { data } = await admin
      .from("ezyvet_contact")
      .select("ezyvet_contact_id, ezyvet_modified_at")
      .in("ezyvet_contact_id", ids.slice(i, i + 1000));
    for (const e of data ?? []) {
      prev.set(e.ezyvet_contact_id as string, (e.ezyvet_modified_at as string | null) ?? null);
    }
  }

  let created = 0;
  let updated = 0;
  const changes: { ezyvet_contact_id: string; import_id: string; change_type: string; changed_fields: Record<string, unknown> | null }[] = [];
  for (const r of rows) {
    if (!prev.has(r.ezyvet_contact_id)) {
      created++;
      changes.push({ ezyvet_contact_id: r.ezyvet_contact_id, import_id: importId, change_type: "created", changed_fields: null });
    } else {
      const before = (prev.get(r.ezyvet_contact_id) ?? "").slice(0, 19);
      const after = (r.ezyvet_modified_at ?? "").slice(0, 19);
      if (before !== after) {
        updated++;
        changes.push({ ezyvet_contact_id: r.ezyvet_contact_id, import_id: importId, change_type: "updated", changed_fields: { ezyvet_modified_at: r.ezyvet_modified_at ?? null } });
      }
    }
  }

  const nowIso = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, last_import_id: importId, updated_at: nowIso }));
    const { error } = await admin.from("ezyvet_contact").upsert(chunk, { onConflict: "ezyvet_contact_id" });
    if (error) {
      return { ok: false, error: error.message, importId, parsed: rows.length, inserted: created, updated, skipped: parsed.skipped };
    }
  }
  if (changes.length) {
    for (let i = 0; i < changes.length; i += 500) {
      await admin.from("ezyvet_contact_change").insert(changes.slice(i, i + 500));
    }
  }

  await admin
    .from("ezyvet_contact_import")
    .update({ new_contacts: created, updated_contacts: updated, unchanged_contacts: rows.length - created - updated })
    .eq("id", importId);

  return { ok: true, importId, parsed: rows.length, inserted: created, updated, skipped: parsed.skipped };
}
