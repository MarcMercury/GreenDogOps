import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseCsv } from "@/lib/reporting/parse";

export interface AgendaIngestResult {
  ok: boolean;
  error?: string;
  /** Data rows read from the CSV. */
  parsed: number;
  /** Rows that were booked appointments (had a client) and mapped to a dept. */
  counted: number;
  /** Distinct (location, day, dept) aggregate rows written. */
  inserted: number;
  /** Covered date window, inclusive. */
  dateStart?: string;
  dateEnd?: string;
  /** Canonical location the ingest was scoped to (per-location pulls only). */
  location?: string;
}

export interface AgendaIngestOptions {
  /**
   * Worker location key of the clinic the ezyVet header was switched to before
   * running the Agenda report (e.g. "van_nuys"). When set, the ingest attributes
   * every row to this one clinic and rebuilds ONLY this clinic's rows for the
   * covered window, so per-location pulls uploaded in sequence don't wipe each
   * other. When omitted, the legacy all-clinic behaviour is used (split by the
   * "Division(s)" column, full-window rebuild).
   */
  locationKey?: string;
}

/** Worker clinic key → canonical `location.name` (lower-cased for matching). */
const LOCATION_KEY_TO_NAME: Record<string, string> = {
  sherman_oaks: "sherman oaks",
  van_nuys: "van nuys",
  venice: "venice",
};

/**
 * Parse the department token out of an ezyVet Agenda "All Resources / Vets"
 * value. The resource name is the department label followed by the clinic
 * street address (or a "Dept* address" form), e.g.
 *   "AP* 14661 Aetna St, Van Nuys, CA 91411"  → "AP"
 *   "Internal Med  210 Main St, Venice CA ..." → "Internal Med"
 *   "2 DVM UV* 210 Main St, Venice, CA 90291"  → "2 DVM UV"
 *   "210 Main St, Venice CA 90291"             → "" (general calendar)
 * Multi-resource rows are semicolon-joined; we key off the first segment.
 */
export function extractDeptLabel(resource: string): string {
  const seg = (resource ?? "").split(";")[0];
  // Treat the "*" separator as whitespace, then cut at the street number.
  const cleaned = seg.replace(/\*/g, " ");
  const m = cleaned.match(/\d{2,}/);
  const name = (m ? cleaned.slice(0, m.index) : cleaned).trim();
  return name;
}

/** Reduce an Agenda "Division(s)" value to a bare clinic name for matching. */
export function extractLocationName(division: string): string {
  const seg = (division ?? "").split(";")[0];
  return seg
    .replace(/green dog\s*-\s*/i, "")
    .replace(/\(bu\)/i, "")
    .trim();
}

/** ezyVet MM-DD-YYYY → ISO YYYY-MM-DD (returns "" if unparseable). */
function toIsoDate(mmddyyyy: string): string {
  const m = (mmddyyyy ?? "").trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return "";
  const [, mo, da, yr] = m;
  return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
}

/** Current date in America/Los_Angeles as ISO YYYY-MM-DD. */
function todayIsoLA(): string {
  const la = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, "0")}-${String(la.getDate()).padStart(2, "0")}`;
}

/**
 * Ingest an ezyVet "Agenda" CSV export (raw text) with the service-role client.
 * Counts booked appointments (rows with a client) per location / day / schedule
 * department, using the editable ezyvet_agenda_dept_map, and rebuilds
 * ezyvet_agenda_count for the covered date window (the Agenda report is a
 * forward snapshot, so a full rebuild keeps moved/cancelled bookings accurate).
 */
export async function ingestAgendaCsvText(
  text: string,
  opts: AgendaIngestOptions = {},
): Promise<AgendaIngestResult> {
  const table = parseCsv(text);
  if (table.length < 2) {
    return { ok: false, error: "Agenda CSV had no data rows.", parsed: 0, counted: 0, inserted: 0 };
  }
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const iResource = col("All Resources / Vets");
  const iDivision = col("Division(s)");
  const iDate = col("Date");
  const iClient = col("Client Name");
  if (iResource < 0 || iDivision < 0 || iDate < 0 || iClient < 0) {
    return {
      ok: false,
      error: `Agenda CSV missing expected columns (got: ${header.join(", ")}).`,
      parsed: table.length - 1,
      counted: 0,
      inserted: 0,
    };
  }

  const admin = createAdminClient();

  // Location name → id (match on the canonical clinic name; ignore inactive
  // duplicates by preferring active rows).
  const { data: locs, error: locErr } = await admin
    .from("location")
    .select("id, name, is_active");
  if (locErr) {
    return { ok: false, error: locErr.message, parsed: table.length - 1, counted: 0, inserted: 0 };
  }
  const locByName = new Map<string, string>();
  for (const l of locs ?? []) {
    const key = String(l.name).toLowerCase();
    if (!locByName.has(key) || l.is_active) locByName.set(key, l.id as string);
  }

  // Per-location pull: resolve the clinic the ezyVet header was switched to. We
  // still attribute each row by its "Division(s)" value (always correct) but
  // only KEEP rows for this clinic and only rebuild this clinic's window — so
  // three per-location uploads in sequence don't delete each other's counts.
  let targetLocationId: string | null = null;
  if (opts.locationKey) {
    const canonical = LOCATION_KEY_TO_NAME[opts.locationKey] ?? opts.locationKey.replace(/_/g, " ");
    targetLocationId = locByName.get(canonical) ?? null;
    if (!targetLocationId) {
      return {
        ok: false,
        error: `Unknown location "${opts.locationKey}" (no matching clinic).`,
        parsed: table.length - 1,
        counted: 0,
        inserted: 0,
      };
    }
  }

  // ezyVet resource label → department (with the '*' catch-all default).
  const { data: maps, error: mapErr } = await admin
    .from("ezyvet_agenda_dept_map")
    .select("ezyvet_label, department_id, is_ignored");
  if (mapErr) {
    return { ok: false, error: mapErr.message, parsed: table.length - 1, counted: 0, inserted: 0 };
  }
  const deptMap = new Map<string, { department_id: string | null; is_ignored: boolean }>();
  for (const m of maps ?? []) {
    deptMap.set(String(m.ezyvet_label), {
      department_id: (m.department_id as string | null) ?? null,
      is_ignored: Boolean(m.is_ignored),
    });
  }
  const fallback = deptMap.get("*");

  // Aggregate booked appointments per (location, date, department).
  const counts = new Map<string, { location_id: string; appt_date: string; department_id: string; appt_count: number }>();
  let counted = 0;
  let minDate = "";
  let maxDate = "";

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (!row || row.length <= iClient) continue;
    const client = (row[iClient] ?? "").trim();
    if (!client) continue; // only real, client-booked appointments

    const isoDate = toIsoDate(row[iDate] ?? "");
    if (!isoDate) continue;
    const locName = extractLocationName(row[iDivision] ?? "").toLowerCase();
    const locationId = locByName.get(locName);
    if (!locationId) continue; // e.g. MPMV / unknown division
    // Per-location pull: keep only rows for the clinic we switched to.
    if (targetLocationId && locationId !== targetLocationId) continue;

    const label = extractDeptLabel(row[iResource] ?? "");
    const mapped = deptMap.get(label) ?? fallback;
    if (!mapped || mapped.is_ignored || !mapped.department_id) continue;

    const key = `${locationId}|${isoDate}|${mapped.department_id}`;
    const entry = counts.get(key);
    if (entry) entry.appt_count += 1;
    else counts.set(key, { location_id: locationId, appt_date: isoDate, department_id: mapped.department_id, appt_count: 1 });
    counted += 1;
    if (!minDate || isoDate < minDate) minDate = isoDate;
    if (!maxDate || isoDate > maxDate) maxDate = isoDate;
  }

  if (counts.size === 0) {
    return { ok: true, parsed: table.length - 1, counted: 0, inserted: 0, location: opts.locationKey };
  }

  // Rebuild the covered window: clear stale rows for the dates present, then
  // insert the fresh aggregates. For a per-location pull, restrict the delete
  // to this clinic so the other locations' counts for the window survive.
  let del = admin
    .from("ezyvet_agenda_count")
    .delete()
    .gte("appt_date", minDate)
    .lte("appt_date", maxDate);
  if (targetLocationId) del = del.eq("location_id", targetLocationId);
  const { error: delErr } = await del;
  if (delErr) {
    return { ok: false, error: delErr.message, parsed: table.length - 1, counted, inserted: 0 };
  }

  const rows = [...counts.values()];
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("ezyvet_agenda_count").insert(rows.slice(i, i + 500));
    if (error) {
      return { ok: false, error: error.message, parsed: table.length - 1, counted, inserted: i };
    }
  }

  // Also record a dated snapshot of these aggregates so the Appointment Review
  // report can compare what was booked (a snapshot taken on/before a day) with
  // what rendered (a snapshot taken after the day). Keyed by snapshot_date so
  // re-running on the same day overwrites rather than duplicating.
  const snapshotDate = todayIsoLA();
  const snapshotRows = rows.map((r) => ({ ...r, snapshot_date: snapshotDate }));
  for (let i = 0; i < snapshotRows.length; i += 500) {
    const { error } = await admin
      .from("ezyvet_agenda_snapshot")
      .upsert(snapshotRows.slice(i, i + 500), {
        onConflict: "location_id,appt_date,department_id,snapshot_date",
      });
    if (error) {
      return { ok: false, error: error.message, parsed: table.length - 1, counted, inserted: rows.length };
    }
  }

  return {
    ok: true,
    parsed: table.length - 1,
    counted,
    inserted: rows.length,
    dateStart: minDate,
    dateEnd: maxDate,
    location: opts.locationKey,
  };
}
