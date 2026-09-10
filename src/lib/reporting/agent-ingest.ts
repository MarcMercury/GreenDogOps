import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseInvoiceCsv,
  parseContactCsv,
  parseAnimalCsv,
  parseProductCsv,
  parseProductPricingCsv,
} from "./parse";

export interface CsvIngestResult {
  ok: boolean;
  error?: string;
  warning?: string;
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

  // Record basic import stats. The (heavy) reporting roll-up refresh is run by
  // the agent's dedicated /api/agents/ezyvet/refresh step after all uploads, so
  // it doesn't block or time out inside this request.
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

  return { ok: true, importId, parsed: rows.length, inserted, skipped: parsed.skipped };
}

/**
 * Ingest an ezyVet "Contacts" CSV export (raw text) using the service-role
 * client. Upserts into ezyvet_contact (dedup on ezyvet_contact_id) and logs
 * created/updated/unchanged for client-growth trend reporting. The full export
 * is ~33k rows, which exceeds the serverless request-body limit even gzipped,
 * so the worker splits it into chunks that all share ONE import row: the first
 * call creates the import (returns its id) and later calls pass it back in via
 * `importId`, with the counters accumulating across chunks.
 */
export async function ingestContactCsvText(
  text: string,
  meta: { filename?: string; snapshotDate?: string | null; importId?: string | null } = {},
): Promise<CsvIngestResult> {
  const parsed = parseContactCsv(text);
  if (parsed.error) {
    return { ok: false, error: parsed.error, parsed: 0, inserted: 0, skipped: 0 };
  }
  const rows = parsed.rows;
  const admin = createAdminClient();

  let importId = meta.importId ?? null;
  if (!importId) {
    const { data: imp, error: impErr } = await admin
      .from("ezyvet_contact_import")
      .insert({
        filename: meta.filename ?? "agent-contacts.csv",
        total_rows: 0,
        snapshot_date: meta.snapshotDate ?? null,
      })
      .select("id")
      .single();
    if (impErr || !imp) {
      return { ok: false, error: impErr?.message ?? "Failed to open import.", parsed: rows.length, inserted: 0, skipped: parsed.skipped };
    }
    importId = imp.id as string;
  }

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

  // Accumulate this chunk's counters onto the shared import row.
  const { data: cur } = await admin
    .from("ezyvet_contact_import")
    .select("total_rows, new_contacts, updated_contacts, unchanged_contacts")
    .eq("id", importId)
    .maybeSingle();
  await admin
    .from("ezyvet_contact_import")
    .update({
      total_rows: (cur?.total_rows ?? 0) + rows.length,
      new_contacts: (cur?.new_contacts ?? 0) + created,
      updated_contacts: (cur?.updated_contacts ?? 0) + updated,
      unchanged_contacts: (cur?.unchanged_contacts ?? 0) + (rows.length - created - updated),
    })
    .eq("id", importId);

  return { ok: true, importId, parsed: rows.length, inserted: created, updated, skipped: parsed.skipped };
}
/**
 * Ingest an ezyVet "Animals" CSV export (the full patient roster) using the
 * service-role client. The snapshot is ~45k rows / 18 MB, which exceeds the
 * serverless request-body limit even gzipped, so the worker splits it into
 * several chunks that all share ONE import row: the first call creates the
 * import (returns its id) and later calls pass it back in via `importId`, with
 * the counters accumulating across chunks.
 */
export async function ingestAnimalCsvText(
  text: string,
  meta: { filename?: string; snapshotDate?: string | null; importId?: string | null } = {},
): Promise<CsvIngestResult> {
  const parsed = parseAnimalCsv(text);
  if (parsed.error) {
    return { ok: false, error: parsed.error, parsed: 0, inserted: 0, skipped: 0 };
  }
  const rows = parsed.rows;
  const admin = createAdminClient();

  let importId = meta.importId ?? null;
  if (!importId) {
    const { data: imp, error: impErr } = await admin
      .from("ezyvet_animal_import")
      .insert({
        filename: meta.filename ?? "agent-animals.csv",
        total_rows: 0,
        snapshot_date: meta.snapshotDate ?? null,
      })
      .select("id")
      .single();
    if (impErr || !imp) {
      return {
        ok: false,
        error: impErr?.message ?? "Failed to open import.",
        parsed: rows.length,
        inserted: 0,
        skipped: parsed.skipped,
      };
    }
    importId = imp.id as string;
  }

  // Classify created vs updated vs unchanged using ezyVet's own modified-at.
  const ids = rows.map((r) => r.ezyvet_animal_id);
  const prev = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 1000) {
    const { data } = await admin
      .from("ezyvet_animal")
      .select("ezyvet_animal_id, ezyvet_modified_at")
      .in("ezyvet_animal_id", ids.slice(i, i + 1000));
    for (const e of data ?? []) {
      prev.set(e.ezyvet_animal_id as string, (e.ezyvet_modified_at as string | null) ?? null);
    }
  }

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    if (!prev.has(r.ezyvet_animal_id)) {
      created++;
      continue;
    }
    const before = (prev.get(r.ezyvet_animal_id) ?? "").slice(0, 19);
    const after = (r.ezyvet_modified_at ?? "").slice(0, 19);
    if (before !== after) updated++;
  }

  const nowIso = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, last_import_id: importId, updated_at: nowIso }));
    const { error } = await admin.from("ezyvet_animal").upsert(chunk, { onConflict: "ezyvet_animal_id" });
    if (error) {
      return { ok: false, error: error.message, importId, parsed: rows.length, inserted: created, updated, skipped: parsed.skipped };
    }
  }

  // Accumulate this chunk's counters onto the shared import row.
  const { data: cur } = await admin
    .from("ezyvet_animal_import")
    .select("total_rows, new_animals, updated_animals, unchanged_animals")
    .eq("id", importId)
    .maybeSingle();
  await admin
    .from("ezyvet_animal_import")
    .update({
      total_rows: (cur?.total_rows ?? 0) + rows.length,
      new_animals: (cur?.new_animals ?? 0) + created,
      updated_animals: (cur?.updated_animals ?? 0) + updated,
      unchanged_animals: (cur?.unchanged_animals ?? 0) + (rows.length - created - updated),
    })
    .eq("id", importId);

  return { ok: true, importId, parsed: rows.length, inserted: created, updated, skipped: parsed.skipped };
}

/** Open (or reuse) the shared import row both product ingests write into. */
async function openProductImport(
  admin: ReturnType<typeof createAdminClient>,
  source: "products" | "pricing",
  meta: { filename?: string; snapshotDate?: string | null; importId?: string | null },
): Promise<{ importId?: string; error?: string }> {
  if (meta.importId) return { importId: meta.importId };
  const { data, error } = await admin
    .from("ezyvet_product_import")
    .insert({
      filename: meta.filename ?? `agent-${source}.csv`,
      source,
      total_rows: 0,
      snapshot_date: meta.snapshotDate ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Failed to open import." };
  return { importId: data.id as string };
}

/** Add this chunk's counters onto the shared import row. */
async function accumulateProductImport(
  admin: ReturnType<typeof createAdminClient>,
  importId: string,
  counts: { total: number; created: number; updated: number },
) {
  const { data: cur } = await admin
    .from("ezyvet_product_import")
    .select("total_rows, new_rows, updated_rows, unchanged_rows")
    .eq("id", importId)
    .maybeSingle();
  await admin
    .from("ezyvet_product_import")
    .update({
      total_rows: (cur?.total_rows ?? 0) + counts.total,
      new_rows: (cur?.new_rows ?? 0) + counts.created,
      updated_rows: (cur?.updated_rows ?? 0) + counts.updated,
      unchanged_rows:
        (cur?.unchanged_rows ?? 0) + (counts.total - counts.created - counts.updated),
    })
    .eq("id", importId);
}

/**
 * Ingest an ezyVet "Products" CSV export (the full product catalog) using the
 * service-role client. Snapshot report — every run is the current catalog, so
 * rows are upserted on ezyvet_product_id and nothing is deleted.
 */
export async function ingestProductCsvText(
  text: string,
  meta: { filename?: string; snapshotDate?: string | null; importId?: string | null } = {},
): Promise<CsvIngestResult> {
  const parsed = parseProductCsv(text);
  if (parsed.error) {
    return { ok: false, error: parsed.error, parsed: 0, inserted: 0, skipped: 0 };
  }
  const rows = parsed.rows;
  const admin = createAdminClient();

  const opened = await openProductImport(admin, "products", meta);
  if (!opened.importId) {
    return { ok: false, error: opened.error, parsed: rows.length, inserted: 0, skipped: parsed.skipped };
  }
  const importId = opened.importId;

  // Classify created vs updated vs unchanged using ezyVet's own modified-at.
  const ids = rows.map((r) => r.ezyvet_product_id);
  const prev = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 1000) {
    const { data } = await admin
      .from("ezyvet_product")
      .select("ezyvet_product_id, ezyvet_modified_at")
      .in("ezyvet_product_id", ids.slice(i, i + 1000));
    for (const e of data ?? []) {
      prev.set(e.ezyvet_product_id as string, (e.ezyvet_modified_at as string | null) ?? null);
    }
  }

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    if (!prev.has(r.ezyvet_product_id)) {
      created++;
      continue;
    }
    const before = (prev.get(r.ezyvet_product_id) ?? "").slice(0, 19);
    const after = (r.ezyvet_modified_at ?? "").slice(0, 19);
    if (before !== after) updated++;
  }

  const nowIso = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, last_import_id: importId, updated_at: nowIso }));
    const { error } = await admin.from("ezyvet_product").upsert(chunk, { onConflict: "ezyvet_product_id" });
    if (error) {
      return { ok: false, error: error.message, importId, parsed: rows.length, inserted: created, updated, skipped: parsed.skipped };
    }
  }

  await accumulateProductImport(admin, importId, { total: rows.length, created, updated });
  return { ok: true, importId, parsed: rows.length, inserted: created, updated, skipped: parsed.skipped };
}

/**
 * Ingest an ezyVet "Product Pricing" CSV export (cost/sell price/markup for
 * every product in every division) using the service-role client. Deduped on
 * product_code + division; a row counts as "updated" when a price changed.
 */
export async function ingestProductPricingCsvText(
  text: string,
  meta: { filename?: string; snapshotDate?: string | null; importId?: string | null } = {},
): Promise<CsvIngestResult> {
  const parsed = parseProductPricingCsv(text);
  if (parsed.error) {
    return { ok: false, error: parsed.error, parsed: 0, inserted: 0, skipped: 0 };
  }
  const rows = parsed.rows;
  const admin = createAdminClient();

  const opened = await openProductImport(admin, "pricing", meta);
  if (!opened.importId) {
    return { ok: false, error: opened.error, parsed: rows.length, inserted: 0, skipped: parsed.skipped };
  }
  const importId = opened.importId;

  // Look up the current cost/price per code+division so a price change shows up
  // in the import counters — this report has no modified-at column.
  const codes = [...new Set(rows.map((r) => r.product_code))];
  const prev = new Map<string, string>();
  for (let i = 0; i < codes.length; i += 500) {
    const { data } = await admin
      .from("ezyvet_product_price")
      .select("product_code, division, cost, sell_price_incl")
      .in("product_code", codes.slice(i, i + 500));
    for (const e of data ?? []) {
      prev.set(`${e.product_code}|${e.division}`, `${e.cost ?? ""}|${e.sell_price_incl ?? ""}`);
    }
  }

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const before = prev.get(`${r.product_code}|${r.division}`);
    if (before === undefined) created++;
    else if (before !== `${r.cost ?? ""}|${r.sell_price_incl ?? ""}`) updated++;
  }

  const nowIso = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, last_import_id: importId, updated_at: nowIso }));
    const { error } = await admin
      .from("ezyvet_product_price")
      .upsert(chunk, { onConflict: "product_code,division" });
    if (error) {
      return { ok: false, error: error.message, importId, parsed: rows.length, inserted: created, updated, skipped: parsed.skipped };
    }
  }

  await accumulateProductImport(admin, importId, { total: rows.length, created, updated });
  return { ok: true, importId, parsed: rows.length, inserted: created, updated, skipped: parsed.skipped };
}
