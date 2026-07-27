#!/usr/bin/env node
// ---------------------------------------------------------------------------
// One-off group update: refresh referral partner "last visit" + contact info
// from a Medical Partnerships CSV export, but ONLY where the CSV represents
// newer visit information than what GreenDog Ops currently has.
//
// Update gate (per matched clinic):
//   * CSV  "Last Visit" is a real date ON OR AFTER  2026-02-03, AND
//   * existing referral_partners.last_visit_date is NULL or BEFORE 2026-02-03.
//
// When the gate passes we update ONLY:
//   * last_visit_date  (from CSV "Last Visit") -- always refreshed
//   * phone / email / address  (from CSV) -- FILL-BLANKS ONLY: written only
//                              when the GDO value is currently empty, so we
//                              restore lost data without clobbering good data.
//   * contact_name  -- FILL-BLANKS ONLY, and only when the CSV "Notes" first
//                      line looks like a real name (starts with "Dr").
//
// We deliberately SKIP everything else (financials/revenue, referral counts,
// tier/priority/zone, and anything auto-maintained by the reporting refresh).
//
// This script is a DRY-RUN generator: it prints a preview and writes SQL to
// .tmp_visitupd/update.sql. Nothing is applied until you run:
//   ./scripts/supabase-sql.sh -f .tmp_visitupd/update.sql
//
//   node scripts/update_referral_visits_from_csv.mjs \
//     public/medical-partnerships-export_2026-07-27.csv \
//     .tmp_visitupd/partners.json \
//     .tmp_visitupd/update.sql
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from "node:fs";

const [, , CSV_PATH, PARTNERS_JSON, OUT_SQL] = process.argv;
if (!CSV_PATH || !PARTNERS_JSON || !OUT_SQL) {
  console.error(
    "Usage: update_referral_visits_from_csv.mjs <csv> <partners.json> <out.sql>",
  );
  process.exit(2);
}

const THRESHOLD = "2026-02-03"; // Feb 3, 2026 (inclusive lower bound for CSV)

// ---------------------------------------------------------------------------
// RFC-4180-ish CSV parser: handles quoted fields, escaped "" quotes, and
// embedded newlines inside quoted cells (the Notes column has multi-line values).
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // flush last field/row (unless file ended on a clean newline with no partial)
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// "Jun 5, 2026" / "Feb 23, 2026" -> "2026-06-05"
const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
function parseLongDate(str) {
  if (!str) return null;
  const m = str.trim().match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${m[2].padStart(2, "0")}`;
}

// Name normalization for matching (mirrors the app's trim+lowercase, but also
// collapses internal whitespace so leading spaces / double spaces don't break).
function normName(v) {
  return (v ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sqlLit(v) {
  if (v == null) return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Load partners and build a name index.
// ---------------------------------------------------------------------------
const partners = JSON.parse(readFileSync(PARTNERS_JSON, "utf8"));
const byName = new Map();
for (const p of partners) {
  for (const key of [normName(p.name), normName(p.hospital_name)]) {
    if (key && !byName.has(key)) byName.set(key, p);
  }
}

// ---------------------------------------------------------------------------
// Parse CSV.
// ---------------------------------------------------------------------------
const rows = parseCSV(readFileSync(CSV_PATH, "utf8"));
const header = rows[0].map((h) => h.trim().toLowerCase());
const col = (name) => header.findIndex((h) => h === name.toLowerCase());
const ci = {
  clinic: col("Clinic Name"),
  phone: col("Phone"),
  email: col("Email"),
  address: col("Address"),
  lastVisit: col("Last Visit"),
  notes: col("Notes"),
};

const updates = [];
const stats = {
  total: 0,
  noName: 0,
  unmatched: 0,
  csvNoDate: 0,
  csvTooOld: 0,
  dbAlreadyRecent: 0,
  eligible: 0,
};
const unmatchedNames = [];

for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.every((c) => (c ?? "").trim() === "")) continue;
  stats.total++;

  const clinic = (r[ci.clinic] ?? "").trim();
  if (!clinic) {
    stats.noName++;
    continue;
  }
  const p = byName.get(normName(clinic));
  if (!p) {
    stats.unmatched++;
    unmatchedNames.push(clinic);
    continue;
  }

  const csvVisit = parseLongDate(r[ci.lastVisit] ?? "");
  if (!csvVisit) {
    stats.csvNoDate++;
    continue;
  }
  if (csvVisit < THRESHOLD) {
    stats.csvTooOld++;
    continue;
  }
  // Existing must be missing OR strictly before the threshold.
  const dbVisit = p.last_visit_date; // "YYYY-MM-DD" or null
  if (dbVisit && dbVisit >= THRESHOLD) {
    stats.dbAlreadyRecent++;
    continue;
  }

  // Gate passed. Collect the contact fields we're allowed to refresh.
  // FILL-BLANKS ONLY: never overwrite a value GDO already has.
  const isBlank = (v) => v == null || String(v).trim() === "";
  const csvPhone = (r[ci.phone] ?? "").trim() || null;
  const csvEmail = (r[ci.email] ?? "").trim() || null;
  const csvAddress = (r[ci.address] ?? "").trim() || null;
  // Notes first line: only accept it as a contact name when it starts with "Dr".
  const notesFirst = ((r[ci.notes] ?? "").split("\n")[0] ?? "").trim();
  const csvContact = /^dr\.?\s/i.test(notesFirst) ? notesFirst : null;

  const set = { last_visit_date: csvVisit }; // always refreshed
  if (csvPhone && isBlank(p.phone)) set.phone = csvPhone;
  if (csvEmail && isBlank(p.email)) set.email = csvEmail;
  if (csvAddress && isBlank(p.address)) set.address = csvAddress;
  if (csvContact && isBlank(p.contact_name)) set.contact_name = csvContact;

  stats.eligible++;
  updates.push({
    id: p.id,
    name: p.name ?? p.hospital_name ?? clinic,
    dbVisit: dbVisit ?? "(none)",
    set,
  });
}

// ---------------------------------------------------------------------------
// Emit preview + SQL.
// ---------------------------------------------------------------------------
console.log("=== Referral last-visit / contact refresh (DRY RUN) ===");
console.log(`Threshold: on/after ${THRESHOLD} (CSV) & before ${THRESHOLD} (DB)`);
console.log(`CSV data rows:            ${stats.total}`);
console.log(`  blank clinic name:      ${stats.noName}`);
console.log(`  unmatched in GDO:       ${stats.unmatched}`);
console.log(`  CSV visit not a date:   ${stats.csvNoDate}`);
console.log(`  CSV visit < threshold:  ${stats.csvTooOld}`);
console.log(`  DB already >= threshold:${stats.dbAlreadyRecent}`);
console.log(`  ELIGIBLE to update:     ${stats.eligible}`);
console.log("");

for (const u of updates) {
  const fields = Object.entries(u.set)
    .map(([k, v]) => `${k}=${v}`)
    .join(" | ");
  console.log(`• ${u.name}`);
  console.log(`    db last_visit ${u.dbVisit} -> ${u.set.last_visit_date}`);
  console.log(`    ${fields}`);
}

if (unmatchedNames.length) {
  console.log("\n--- Unmatched clinic names (skipped) ---");
  for (const n of unmatchedNames) console.log(`  ? ${n}`);
}

// SQL: one UPDATE per eligible partner, guarded again in SQL by the same date
// conditions so re-running is safe / idempotent w.r.t. the threshold.
const lines = [
  "-- Generated by scripts/update_referral_visits_from_csv.mjs",
  "-- Group refresh of referral last_visit_date + contact info from CSV export.",
  "begin;",
];
for (const u of updates) {
  const sets = Object.entries(u.set).map(([k, v]) => `${k} = ${sqlLit(v)}`);
  sets.push("updated_at = now()");
  lines.push(
    `update greendogops.referral_partners set ${sets.join(", ")} ` +
      `where id = ${sqlLit(u.id)} ` +
      `and (last_visit_date is null or last_visit_date < date '${THRESHOLD}');`,
  );
}
lines.push("commit;");
writeFileSync(OUT_SQL, lines.join("\n") + "\n");
console.log(`\nWrote ${updates.length} UPDATE statements to ${OUT_SQL}`);
