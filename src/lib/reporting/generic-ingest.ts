import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  clean,
  normalizeHeader,
  parseCsv,
  resolveLocation,
  toBool,
  toIsoDate,
  toIsoTimestamp,
  toNumber,
} from "./parse";
import { REPORT_SPECS, type ColumnSpec, type ReportSpec } from "./report-specs";

export type GenericIngestResult = {
  ok: boolean;
  report: string;
  parsed: number;
  inserted: number;
  skipped: number;
  dateStart: string | null;
  dateEnd: string | null;
  warning?: string;
  error?: string;
};

type Row = Record<string, string | number | boolean | null>;

/** Rows whose first cell is one of these are report footers, not data. */
const FOOTER_FIRST_CELL = new Set([
  "total", "totals", "average", "averages", "grand total", "sum", "subtotal",
  "count", "report total", "summary",
]);

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Some reports render dates long-form: "26th August 2026 09:00AM".
 * Returns { date, timestamp } in ISO, or nulls when it doesn't match.
 */
function parseLongDate(value: string | undefined): { date: string | null; timestamp: string | null } {
  const t = clean(value);
  const m = t?.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
  if (!m) return { date: null, timestamp: null };
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return { date: null, timestamp: null };
  const date = `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (!m[4]) return { date, timestamp: `${date}T00:00:00Z` };
  let hh = Number(m[4]);
  const pm = m[6]?.toUpperCase() === "PM";
  if (hh === 12) hh = pm ? 12 : 0;
  else if (pm) hh += 12;
  return { date, timestamp: `${date}T${String(hh).padStart(2, "0")}:${m[5]}:00Z` };
}

function coerce(value: string | undefined, type: ColumnSpec["type"]): Row[string] {
  switch (type) {
    case "numeric":
      return toNumber(value);
    case "int": {
      const n = toNumber(value);
      return n == null ? null : Math.round(n);
    }
    case "bool":
      return toBool(value);
    case "date":
      return toIsoDate(value);
    case "timestamp":
      return toIsoTimestamp(value);
    case "label":
      // Metric labels arrive as "American Express:" / "Pending Invoices".
      return clean(value)?.replace(/:$/, "").trim() || null;
    case "leading_int": {
      // Staff Sales packs both values into one cell: "957081 (09-09-2026 8:42am)".
      const m = clean(value)?.match(/^(\d+)/);
      return m ? Number(m[1]) : null;
    }
    case "paren_timestamp":
      return toIsoTimestamp(clean(value)?.match(/\(([^)]+)\)/)?.[1]);
    case "paren_date":
      return toIsoDate(clean(value)?.match(/\(([^)]+)\)/)?.[1]);
    case "long_date":
      return parseLongDate(value).date;
    case "long_timestamp":
      return parseLongDate(value).timestamp;
    default:
      return clean(value);
  }
}

/**
 * Locate the real header row. ezyVet exports often carry a preamble (a title, a
 * metadata block, or a section label such as the payment method) before the
 * column names, so scan for the first row containing every required header.
 * A required name ending in "(" is matched by prefix, because some headers
 * embed the run date, e.g. "Due(09-09-2026)".
 */
function findHeaderRow(rows: string[][], required: string[]): number {
  const want = required.map(normalizeHeader);
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const have = rows[i].map(normalizeHeader);
    const ok = want.every((w) =>
      w.endsWith("(") ? have.some((h) => h.startsWith(w)) : have.includes(w),
    );
    if (ok) return i;
  }
  return -1;
}

/** Resolve a spec column to its index in the parsed header. */
function columnIndex(index: Map<string, number>, csv: string): number | undefined {
  const want = normalizeHeader(csv);
  const exact = index.get(want);
  if (exact != null) return exact;
  if (!want.endsWith("(")) return undefined;
  for (const [h, i] of index) if (h.startsWith(want)) return i;
  return undefined;
}

/**
 * Some reports repeat the whole table once per section (Payment Summary emits a
 * bare payment-method line, then the header, then that method's payments). This
 * returns the section label when `row` is such a divider, else null.
 */
function sectionLabel(row: string[]): string | null {
  const filled = row.map((c) => c.trim()).filter(Boolean);
  return filled.length === 1 ? filled[0] : null;
}

function isFooter(row: string[]): boolean {
  const first = (row[0] ?? "").trim().toLowerCase();
  if (FOOTER_FIRST_CELL.has(first)) return true;
  // Footers also appear as a mostly-empty row with a "Total" label mid-way.
  const filled = row.map((c) => c.trim()).filter(Boolean);
  return filled.length > 1 && filled.length <= 3 && filled.some((c) => FOOTER_FIRST_CELL.has(c.toLowerCase()));
}

/**
 * "End of Day Totals" has no header — it is a list of `label,amount` pairs
 * (Pending Invoices, Approved Invoices, Opening/Closing Debtors, one row per
 * payment method). Stored long-form as one metric per row.
 */
function parseKeyValueCsv(raw: string[][], spec: ReportSpec): { rows: Row[]; skipped: number } {
  const [metricCol, valueCol] = spec.columns;
  const rows: Row[] = [];
  let skipped = 0;
  for (const cells of raw) {
    const metric = clean(cells[0]);
    const amount = toNumber(cells[1]);
    if (!metric || amount == null) {
      skipped++;
      continue;
    }
    rows.push({ [metricCol.column]: metric, [valueCol.column]: amount });
  }
  return { rows, skipped };
}

/**
 * Parse a raw ezyVet CSV export into typed rows using a declarative spec.
 * Exported for tests/probes; the ingest below is the normal entry point.
 */
export function parseReportCsv(
  text: string,
  spec: ReportSpec,
): { rows: Row[]; skipped: number; error?: string } {
  const raw = parseCsv(text);
  if (raw.length === 0) return { rows: [], skipped: 0, error: "empty CSV" };
  if (spec.layout === "key-value") return parseKeyValueCsv(raw, spec);

  const headerRow = findHeaderRow(raw, spec.required);
  if (headerRow < 0) {
    return { rows: [], skipped: 0, error: `header row not found (need: ${spec.required.join(", ")})` };
  }
  const header = raw[headerRow].map(normalizeHeader);
  const headerKey = header.join("\u0001");
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    if (!index.has(h)) index.set(h, i);
  });

  const rows: Row[] = [];
  let skipped = 0;
  // The FIRST section divider sits above the header row (Payment Summary opens
  // with a bare "Visa" line, then the column names), so seed from the preamble.
  let section: string | null = null;
  for (let i = headerRow - 1; i >= 0; i--) {
    const label = sectionLabel(raw[i]);
    if (label) {
      section = spec.sectionStrip ? label.replace(spec.sectionStrip, "").trim() : label;
      break;
    }
  }

  // Aged Receivables names its aging columns after the calendar months they
  // cover ("June+, July, August, September"), so they move every month. Resolve
  // them positionally instead: newest bucket first, working back in time.
  const bucketAt: number[] = [];
  if (spec.buckets) {
    const stop = columnIndex(index, spec.buckets.before);
    const start = columnIndex(index, spec.buckets.after);
    if (stop != null && start != null) {
      for (let i = stop - 1; i > start; i--) bucketAt.push(i);
    }
  }

  for (let i = headerRow + 1; i < raw.length; i++) {
    const cells = raw[i];
    if (cells.every((c) => c.trim() === "")) continue;
    if (cells.map(normalizeHeader).join("\u0001") === headerKey) continue; // repeated header
    const label = sectionLabel(cells);
    if (label) {
      // A "Total" divider means the per-section detail is over and the grand
      // total block follows — everything after it would double-count.
      if (FOOTER_FIRST_CELL.has(label.toLowerCase())) break;
      section = spec.sectionStrip ? label.replace(spec.sectionStrip, "").trim() : label;
      continue;
    }
    if (isFooter(cells)) {
      skipped++;
      continue;
    }

    const row: Row = {};
    for (const col of spec.columns) {
      const at = columnIndex(index, col.csv);
      row[col.column] = at == null ? null : coerce(cells[at], col.type);
    }
    spec.buckets?.columns.forEach((column, n) => {
      row[column] = bucketAt[n] == null ? null : toNumber(cells[bucketAt[n]]);
    });
    if (spec.sectionColumn) row[spec.sectionColumn] = section;
    if (spec.locationFrom || spec.locationFromSection) {
      const src = spec.locationFrom ? columnIndex(index, spec.locationFrom) : undefined;
      const label = src == null ? null : clean(cells[src]);
      row.location_key = resolveLocation(spec.locationFromSection ? section : label, null).key;
    }

    // A row with nothing in any identity column is a spacer, not a record.
    const identity = spec.identity ?? spec.columns.slice(0, 1).map((c) => c.column);
    if (identity.every((c) => row[c] == null)) {
      skipped++;
      continue;
    }
    rows.push(row);
  }
  return { rows, skipped };
}

/**
 * Ingest one ezyVet report CSV into its table.
 *
 * Reports with a natural key (`spec.conflict`) are upserted. The rest are
 * SNAPSHOT or WINDOW reports with no stable row id, so the covered date window
 * is deleted and re-inserted — that keeps a re-run idempotent instead of
 * doubling the data (the same approach the agenda ingest uses).
 */
export async function ingestReportCsvText(
  reportKey: string,
  text: string,
  opts: { from?: string | null; to?: string | null; filename?: string | null } = {},
): Promise<GenericIngestResult> {
  const spec = REPORT_SPECS[reportKey];
  const base: GenericIngestResult = {
    ok: false, report: reportKey, parsed: 0, inserted: 0, skipped: 0, dateStart: null, dateEnd: null,
  };
  if (!spec) return { ...base, error: `unknown report "${reportKey}"` };

  const { rows, skipped, error } = parseReportCsv(text, spec);
  if (error) return { ...base, skipped, error };

  const supabase = createAdminClient();
  const table = spec.table;
  const snapshotDate = opts.to ?? new Date().toISOString().slice(0, 10);

  // Stamp every row with the pull that produced it so a partial re-run is
  // traceable and snapshot reports can be trended over time.
  const stamped = rows.map((r) => ({
    ...r,
    snapshot_date: snapshotDate,
    period_start: opts.from ?? null,
    period_end: opts.to ?? null,
  }));

  let dateStart: string | null = null;
  let dateEnd: string | null = null;
  if (spec.dateColumn) {
    const dates = stamped
      .map((r) => r[spec.dateColumn as string])
      .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    dateStart = dates[0] ?? null;
    dateEnd = dates[dates.length - 1] ?? null;
  }

  if (!spec.conflict) {
    // Window rebuild. Scope the delete to the window we ASKED for rather than
    // the window the data happens to span — a report that returns a stray old
    // row must never widen the delete into history this pull did not re-read.
    const from = opts.from ?? dateStart;
    const to = opts.to ?? dateEnd;
    const del = supabase.schema("greendogops").from(table).delete();
    const scoped = spec.dateColumn && from && to
      ? del.gte(spec.dateColumn, from).lte(spec.dateColumn, to)
      : del.eq("snapshot_date", snapshotDate);
    const { error: delError } = await scoped;
    if (delError) return { ...base, skipped, error: `delete failed: ${delError.message}` };
  }

  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < stamped.length; i += CHUNK) {
    const slice = stamped.slice(i, i + CHUNK);
    const query = supabase.schema("greendogops").from(table);
    const { error: writeError } = spec.conflict
      ? await query.upsert(slice, { onConflict: spec.conflict.join(","), ignoreDuplicates: false })
      : await query.insert(slice);
    if (writeError) {
      return { ...base, parsed: rows.length, inserted, skipped, dateStart, dateEnd, error: writeError.message };
    }
    inserted += slice.length;
  }

  return { ok: true, report: reportKey, parsed: rows.length, inserted, skipped, dateStart, dateEnd };
}
