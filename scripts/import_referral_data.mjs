#!/usr/bin/env node
// ---------------------------------------------------------------------------
// One-off bulk importer for the "Referral Data Upload" folder.
//
// Faithfully replicates the parsing / clinic-matching / dedup-hash logic used
// by the in-app EzyVet uploader (src/app/(app)/crm/referral/actions.ts) so that
// the ledger this produces is byte-for-byte compatible with future UI uploads
// (re-uploading the same file will collide on dedup_hash and be skipped).
//
// It does NOT touch the database directly. It reads the CSVs + a partners.json
// snapshot and writes .tmp_referral/import.sql, which is applied separately via
// scripts/supabase-sql.sh (Supabase Management API).
//
//   node scripts/import_referral_data.mjs \
//        "public/Referral Data Upload" .tmp_referral/partners.json .tmp_referral/import.sql
// ---------------------------------------------------------------------------
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [, , DIR, PARTNERS_JSON, OUT_SQL] = process.argv;
if (!DIR || !PARTNERS_JSON || !OUT_SQL) {
  console.error("Usage: import_referral_data.mjs <dir> <partners.json> <out.sql>");
  process.exit(2);
}

// ===========================================================================
// CSV + date helpers (ported verbatim)
// ===========================================================================
function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) { fields.push(current.trim()); current = ""; }
    else current += char;
  }
  fields.push(current.trim());
  return fields;
}

function parseEzyVetDate(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

function detectReportType(csvText) {
  const firstLine = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")[0].toLowerCase();
  if (firstLine.includes("clinic name") && firstLine.includes("date of last referral")) return "statistics";
  if (firstLine.includes("date/time") && firstLine.includes("referring vet clinic")) return "revenue";
  return "revenue";
}

function parseRevenueCSV(csvText) {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCSVLine(line);
    if (fields.length < 7) continue;
    const dateTime = fields[0].trim();
    const clinicName = fields[1].trim();
    if (!dateTime || !clinicName) continue;
    if (clinicName.toLowerCase() === "unknown clinic") continue;
    if (clinicName.toLowerCase().startsWith("total")) continue;
    const amount = parseFloat(fields[6].trim().replace(/[,$]/g, "")) || 0;
    if (amount <= 0) continue;
    entries.push({
      clinicName, referringVet: fields[2]?.trim() || "", clientName: fields[3]?.trim() || "",
      animalName: fields[4]?.trim() || "", amount, date: dateTime, division: fields[5]?.trim() || "",
    });
  }
  return entries;
}

function parseStatisticsCSV(csvText) {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const entries = [];
  const headerFields = parseCSVLine(lines[0]);
  let clinicNameIdx = headerFields.findIndex((h) => h.toLowerCase().includes("clinic name"));
  let lastReferralIdx = headerFields.findIndex((h) => h.toLowerCase().includes("date of last referral"));
  let total12MonthsIdx = headerFields.findIndex((h) => h.toLowerCase().includes("total referrals 12 months"));
  if (clinicNameIdx === -1) clinicNameIdx = 0;
  if (lastReferralIdx === -1) lastReferralIdx = 2;
  if (total12MonthsIdx === -1) total12MonthsIdx = 6;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCSVLine(line);
    if (fields.length < 7) continue;
    const clinicName = fields[clinicNameIdx]?.trim() || "";
    if (!clinicName || clinicName.toLowerCase() === "unknown") continue;
    const lastReferralStr = fields[lastReferralIdx]?.trim() || "";
    let lastReferralDate = null;
    if (lastReferralStr && lastReferralStr.toLowerCase() !== "n/a") {
      const parts = lastReferralStr.split("-");
      if (parts.length === 3) {
        const [month, day, year] = parts;
        lastReferralDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      }
    }
    entries.push({
      clinicName, lastReferralDate,
      totalReferrals12Months: parseInt(fields[total12MonthsIdx]?.trim() || "", 10) || 0,
    });
  }
  return entries;
}

function aggregateRevenueByClinic(entries) {
  const clinicMap = new Map();
  for (const entry of entries) {
    const existing = clinicMap.get(entry.clinicName) || { visits: 0, revenue: 0, lastDate: null, divisions: new Set() };
    existing.visits += 1;
    existing.revenue += entry.amount;
    if (entry.division) existing.divisions.add(entry.division);
    const parsedDate = parseEzyVetDate(entry.date);
    if (parsedDate && (!existing.lastDate || parsedDate > existing.lastDate)) existing.lastDate = parsedDate;
    clinicMap.set(entry.clinicName, existing);
  }
  return Array.from(clinicMap.entries()).map(([clinicName, stats]) => ({
    clinicName, totalVisits: stats.visits, totalRevenue: Math.round(stats.revenue * 100) / 100,
    lastReferralDate: stats.lastDate, divisions: [...stats.divisions].sort(),
  }));
}

// ===========================================================================
// Clinic -> partner matching (ported verbatim)
// ===========================================================================
function normalizeNameForComparison(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}
const GENERIC_WORDS = new Set([
  "the", "and", "for", "of", "at", "in", "vet", "vets", "pet", "pets", "animal", "animals",
  "clinic", "clinics", "hospital", "hospitals", "center", "centre", "medical", "veterinary",
  "care", "health", "wellness", "group", "practice", "dr", "dvm", "inc", "llc", "corp",
]);
function extractKeywords(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 1 && !GENERIC_WORDS.has(w));
}
function findBestMatch(clinicName, partners) {
  const normalizedInput = normalizeNameForComparison(clinicName);
  let match = partners.find((p) => (p.name || "").toLowerCase().trim() === clinicName.toLowerCase().trim());
  if (match) return match;
  match = partners.find((p) => normalizeNameForComparison(p.name || "") === normalizedInput);
  if (match) return match;
  match = partners.find((p) => {
    const normalizedPartner = normalizeNameForComparison(p.name || "");
    const shorter = normalizedInput.length < normalizedPartner.length ? normalizedInput : normalizedPartner;
    if (shorter.length < 6) return false;
    return normalizedInput.includes(normalizedPartner) || normalizedPartner.includes(normalizedInput);
  });
  if (match) return match;
  const inputKeywords = extractKeywords(clinicName);
  if (inputKeywords.length === 0) return null;
  const minRequiredMatches = inputKeywords.length >= 2 ? 2 : 1;
  let bestMatch = null;
  let bestScore = 0;
  for (const p of partners) {
    const partnerKeywords = extractKeywords(p.name || "");
    if (partnerKeywords.length === 0) continue;
    let matchCount = 0;
    for (const iw of inputKeywords) if (partnerKeywords.some((pw) => pw === iw)) matchCount++;
    if (matchCount >= minRequiredMatches && matchCount > bestScore) { bestScore = matchCount; bestMatch = p; }
  }
  return bestMatch;
}

// ===========================================================================
// SQL literal helpers
// ===========================================================================
function q(v) {
  if (v === null || v === undefined || v === "") return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}
function numLit(v) {
  return Number.isFinite(v) ? String(v) : "null";
}
function arrLit(values) {
  if (!values || values.length === 0) return "'{}'::text[]";
  return `ARRAY[${values.map((v) => q(v)).join(",")}]::text[]`;
}

// ===========================================================================
// Load inputs
// ===========================================================================
const partners = JSON.parse(readFileSync(PARTNERS_JSON, "utf-8")).map((p) => ({
  id: p.id,
  name: p.name || "",
  referral_divisions: Array.isArray(p.referral_divisions) ? p.referral_divisions : [],
  last_referral_date: p.last_referral_date ? String(p.last_referral_date).split("T")[0] : null,
}));

const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".csv")).sort();
const revenueFiles = files.filter((f) => f.toLowerCase().startsWith("referrer revenue"));
const statsFiles = files.filter((f) => f.toLowerCase().startsWith("referral statistics"));

const sql = [];
sql.push("begin;");

const summary = {
  revenueFiles: 0, statsFiles: 0, lineItems: 0, matchedLineItems: 0, unmatchedLineItems: 0,
  totalRevenue: 0, invalidDateRows: 0,
};
const unmatchedClinics = new Map(); // clinicName -> { revenue, txns }

// In-memory tracking so partner last_referral_date "greatest" logic works across files.
const partnerLast = new Map(partners.map((p) => [p.id, p.last_referral_date]));
const partnerDivisions = new Map(partners.map((p) => [p.id, new Set(p.referral_divisions)]));

// ---------------------------------------------------------------------------
// Revenue files — each processed independently as its own upload
// ---------------------------------------------------------------------------
for (const file of revenueFiles) {
  const csvText = readFileSync(join(DIR, file), "utf-8");
  if (detectReportType(csvText) !== "revenue") continue;
  const entries = parseRevenueCSV(csvText);
  if (entries.length === 0) continue;
  summary.revenueFiles++;

  const uploadId = randomUUID();
  const aggregated = aggregateRevenueByClinic(entries);
  const clinicToPartner = new Map();
  for (const agg of aggregated) {
    const m = findBestMatch(agg.clinicName, partners);
    if (m) clinicToPartner.set(agg.clinicName, m);
  }

  // Partner division merge (matches app's revenue branch).
  for (const agg of aggregated) {
    const m = clinicToPartner.get(agg.clinicName);
    if (!m) {
      const prev = unmatchedClinics.get(agg.clinicName) || { revenue: 0, txns: 0 };
      prev.revenue += agg.totalRevenue;
      prev.txns += agg.totalVisits;
      unmatchedClinics.set(agg.clinicName, prev);
      continue;
    }
    for (const d of agg.divisions) partnerDivisions.get(m.id)?.add(d);
  }

  // Line items with per-file sequence-aware dedup hashes.
  const sortedEntries = [...entries].sort((a, b) => {
    const aDate = parseEzyVetDate(a.date) || a.date;
    const bDate = parseEzyVetDate(b.date) || b.date;
    return aDate.localeCompare(bDate) || a.clinicName.localeCompare(b.clinicName) || a.clientName.localeCompare(b.clientName) ||
      a.animalName.localeCompare(b.animalName) || (a.amount - b.amount) || a.referringVet.localeCompare(b.referringVet);
  });
  const seqCounters = new Map();
  const rows = [];
  const dates = [];
  let fileRevenue = 0;
  for (const entry of sortedEntries) {
    const parsedDate = parseEzyVetDate(entry.date);
    if (!parsedDate || !/^\d{4}-\d{2}-\d{2}$/.test(parsedDate)) { summary.invalidDateRows++; continue; }
    const partner = clinicToPartner.get(entry.clinicName);
    const amount = Math.round(entry.amount * 100) / 100;
    const seqKey = [parsedDate, entry.clinicName, entry.clientName, entry.animalName, entry.amount.toFixed(2)].join("|");
    const seq = (seqCounters.get(seqKey) ?? 0) + 1;
    seqCounters.set(seqKey, seq);
    const dedupHash = createHash("sha256").update(`${seqKey}|${entry.referringVet}|${seq}`).digest("hex").slice(0, 40);
    rows.push(
      `(${partner ? q(partner.id) : "null"}, ${q(parsedDate)}, ${q(entry.clinicName)}, ${q(entry.referringVet)}, ` +
      `${q(entry.clientName)}, ${q(entry.animalName)}, ${q(entry.division)}, ${numLit(amount)}, ` +
      `${q(dedupHash)}, ${seq}, ${q(uploadId)})`,
    );
    dates.push(parsedDate);
    fileRevenue += amount;
    summary.lineItems++;
    if (partner) summary.matchedLineItems++; else summary.unmatchedLineItems++;
  }
  summary.totalRevenue += fileRevenue;
  dates.sort();
  const rangeStart = dates[0] || null;
  const rangeEnd = dates[dates.length - 1] || null;

  // Upload-log row.
  sql.push(
    `insert into greendogops.referral_sync_history ` +
    `(id, filename, report_type, data_source, date_range_start, date_range_end, total_rows_parsed, total_rows_matched, total_revenue_added, sync_details) values ` +
    `(${q(uploadId)}, ${q(file)}, 'revenue', 'bulk_import', ${q(rangeStart)}, ${q(rangeEnd)}, ${rows.length}, ${summary.matchedLineItems}, ${numLit(Math.round(fileRevenue * 100) / 100)}, '{"source":"bulk_import"}'::jsonb);`,
  );

  // Line items (batched, dedup-safe).
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    sql.push(
      `insert into greendogops.referral_revenue_line_items ` +
      `(partner_id, transaction_date, csv_clinic_name, referring_vet, client_name, animal_name, division, amount, dedup_hash, row_index, upload_id) values\n` +
      batch.join(",\n") +
      `\non conflict (dedup_hash) do nothing;`,
    );
  }
}

// ---------------------------------------------------------------------------
// Statistics files — update rolling 12-month counts + last referral dates
// ---------------------------------------------------------------------------
for (const file of statsFiles) {
  const csvText = readFileSync(join(DIR, file), "utf-8");
  if (detectReportType(csvText) !== "statistics") continue;
  const entries = parseStatisticsCSV(csvText);
  if (entries.length === 0) continue;
  summary.statsFiles++;

  const uploadId = randomUUID();
  const statsDates = [];
  let matched = 0;
  for (const entry of entries) {
    const m = findBestMatch(entry.clinicName, partners);
    if (!m) {
      const prev = unmatchedClinics.get(entry.clinicName) || { revenue: 0, txns: 0 };
      prev.txns += entry.totalReferrals12Months;
      unmatchedClinics.set(entry.clinicName, prev);
      continue;
    }
    matched++;
    const sets = [
      `referrals_last_12_months = ${entry.totalReferrals12Months}`,
      `last_sync_date = now()`,
      `last_data_source = 'bulk_import'`,
    ];
    if (entry.lastReferralDate) {
      sets.push(`last_contact_date = ${q(entry.lastReferralDate)}`);
      const existing = partnerLast.get(m.id);
      if (!existing || entry.lastReferralDate > existing) {
        sets.push(`last_referral_date = ${q(entry.lastReferralDate)}`);
        partnerLast.set(m.id, entry.lastReferralDate);
      }
      statsDates.push(entry.lastReferralDate);
    }
    sql.push(`update greendogops.referral_partners set ${sets.join(", ")}, updated_at = now() where id = ${q(m.id)};`);
  }
  statsDates.sort();
  sql.push(
    `insert into greendogops.referral_sync_history ` +
    `(id, filename, report_type, data_source, date_range_start, date_range_end, total_rows_parsed, total_rows_matched, sync_details) values ` +
    `(${q(uploadId)}, ${q(file)}, 'statistics', 'bulk_import', ${q(statsDates[0] || null)}, ${q(statsDates[statsDates.length - 1] || null)}, ${entries.length}, ${matched}, '{"source":"bulk_import"}'::jsonb);`,
  );
}

// ---------------------------------------------------------------------------
// Partner division merges (revenue branch)
// ---------------------------------------------------------------------------
for (const p of partners) {
  const merged = [...(partnerDivisions.get(p.id) || new Set())].sort();
  const before = [...new Set(p.referral_divisions)].sort();
  if (merged.length && JSON.stringify(merged) !== JSON.stringify(before)) {
    sql.push(`update greendogops.referral_partners set referral_divisions = ${arrLit(merged)}, last_sync_date = now(), last_data_source = 'bulk_import' where id = ${q(p.id)};`);
  }
}

sql.push("commit;");
// Derive totals / tier / priority / health from the freshly populated ledger.
sql.push("select 1 from greendogops.recalculate_partner_metrics() limit 1;");

writeFileSync(OUT_SQL, sql.join("\n") + "\n", "utf-8");

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const unmatchedList = [...unmatchedClinics.entries()]
  .sort((a, b) => b[1].revenue - a[1].revenue)
  .map(([name, v]) => ({ name, revenue: Math.round(v.revenue * 100) / 100, txns: v.txns }));

console.log(JSON.stringify({
  ...summary,
  totalRevenue: Math.round(summary.totalRevenue * 100) / 100,
  unmatchedClinicCount: unmatchedList.length,
  unmatchedClinics: unmatchedList,
}, null, 2));
