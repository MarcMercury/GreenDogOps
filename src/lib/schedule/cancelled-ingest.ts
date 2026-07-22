import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseCsv } from "@/lib/reporting/parse";

export interface CancelledIngestResult {
  ok: boolean;
  error?: string;
  /** Data rows read from the report (excluding metadata + header). */
  parsed: number;
  /** Rows that resolved to a date and were stored. */
  inserted: number;
  /** Covered date window, inclusive. */
  dateStart?: string;
  dateEnd?: string;
}

/** ezyVet MM-DD-YYYY (optionally with a trailing time) → ISO YYYY-MM-DD. */
function toIsoDate(value: string): string {
  const m = (value ?? "").trim().match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!m) return "";
  const [, mo, da, yr] = m;
  return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
}

/**
 * Ingest an ezyVet "Canceled Appointments" report export (raw text). The report
 * carries a metadata block before the real header row, so we scan for the row
 * whose cells include Type / Using / Reason and parse from there. The clinic is
 * identified from the "Using" address column (it contains the city name). The
 * covered date window is rebuilt on every pull so re-runs never duplicate.
 */
export async function ingestCancelledCsvText(
  text: string,
): Promise<CancelledIngestResult> {
  const table = parseCsv(text);
  if (table.length < 2) {
    return { ok: false, error: "Cancelled Appointments report had no data.", parsed: 0, inserted: 0 };
  }

  // Locate the header row (the report prepends a title + metadata block).
  let headerIdx = -1;
  for (let r = 0; r < Math.min(table.length, 40); r++) {
    const cells = table[r].map((c) => (c ?? "").trim().toLowerCase());
    if (cells.includes("type") && cells.includes("using") && cells.includes("reason")) {
      headerIdx = r;
      break;
    }
  }
  if (headerIdx < 0) {
    return {
      ok: false,
      error: "Could not find the report header row (Type / Using / Reason).",
      parsed: 0,
      inserted: 0,
    };
  }

  const header = table[headerIdx].map((h) => (h ?? "").trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const iType = col("Type");
  const iStart = col("Start Time");
  const iEnd = col("End Time");
  const iWith = col("With");
  const iUsing = col("Using");
  const iDesc = col("Description");
  const iStatus = col("Status");
  const iReason = col("Reason");
  const iCreated = col("Created");
  const iModified = col("Last Modified");

  const admin = createAdminClient();

  // Location name → id (prefer active rows), matched against the "Using" text.
  const { data: locs, error: locErr } = await admin
    .from("location")
    .select("id, name, is_active");
  if (locErr) {
    return { ok: false, error: locErr.message, parsed: 0, inserted: 0 };
  }
  const locByName: { name: string; id: string }[] = [];
  const seen = new Map<string, { name: string; id: string; active: boolean }>();
  for (const l of locs ?? []) {
    const key = String(l.name).toLowerCase();
    const prev = seen.get(key);
    if (!prev || (!prev.active && l.is_active)) {
      seen.set(key, { name: key, id: l.id as string, active: Boolean(l.is_active) });
    }
  }
  for (const v of seen.values()) locByName.push({ name: v.name, id: v.id });
  // Longest name first so "sherman oaks" wins over a hypothetical "oaks".
  locByName.sort((a, b) => b.name.length - a.name.length);

  const resolveLocation = (using: string): string | null => {
    const hay = using.toLowerCase();
    for (const l of locByName) {
      if (l.name && hay.includes(l.name)) return l.id;
    }
    return null;
  };

  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

  interface CancelRow {
    location_id: string | null;
    appt_date: string;
    appt_type: string | null;
    start_time: string | null;
    end_time: string | null;
    with_who: string | null;
    using_resource: string | null;
    description: string | null;
    status: string | null;
    reason: string | null;
    created_raw: string | null;
    modified_raw: string | null;
  }
  const rows: CancelRow[] = [];
  let parsed = 0;
  let minDate = "";
  let maxDate = "";

  for (let r = headerIdx + 1; r < table.length; r++) {
    const row = table[r];
    if (!row || !row.some((c) => (c ?? "").trim())) continue;
    const start = cell(row, iStart);
    const isoDate = toIsoDate(start);
    if (!isoDate) continue; // skip footer / totals / stray rows without a date
    parsed += 1;
    const using = cell(row, iUsing);
    rows.push({
      location_id: resolveLocation(using),
      appt_date: isoDate,
      appt_type: cell(row, iType) || null,
      start_time: start || null,
      end_time: cell(row, iEnd) || null,
      with_who: cell(row, iWith) || null,
      using_resource: using || null,
      description: cell(row, iDesc) || null,
      status: cell(row, iStatus) || null,
      reason: cell(row, iReason) || null,
      created_raw: cell(row, iCreated) || null,
      modified_raw: cell(row, iModified) || null,
    });
    if (!minDate || isoDate < minDate) minDate = isoDate;
    if (!maxDate || isoDate > maxDate) maxDate = isoDate;
  }

  if (rows.length === 0) {
    return { ok: true, parsed, inserted: 0 };
  }

  // Rebuild the covered window: clear stale rows for the dates present, then
  // insert the fresh set (this report spans all clinics in one pull).
  const { error: delErr } = await admin
    .from("ezyvet_cancelled_appointment")
    .delete()
    .gte("appt_date", minDate)
    .lte("appt_date", maxDate);
  if (delErr) {
    return { ok: false, error: delErr.message, parsed, inserted: 0 };
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("ezyvet_cancelled_appointment")
      .insert(rows.slice(i, i + 500));
    if (error) {
      return { ok: false, error: error.message, parsed, inserted: i };
    }
  }

  return { ok: true, parsed, inserted: rows.length, dateStart: minDate, dateEnd: maxDate };
}
