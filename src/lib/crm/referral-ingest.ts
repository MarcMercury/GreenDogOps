import "server-only";

import { createHash } from "crypto";
import * as XLSX from "xlsx";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows, mapWithConcurrency } from "@/lib/supabase/paginate";

// ---------------------------------------------------------------------------
// Shared ezyVet referral-report ingest. Used by BOTH the in-app uploader
// (crm/referral/actions.ts → parseReferralUpload) and the agent worker
// endpoint (api/agents/ezyvet/referral). Keeping the parsing, clinic-matching,
// dedup-hash and partner-update logic in one place ensures the daily agent and
// manual uploads produce identical, non-duplicating results.
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>;

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export type ReportType = "revenue" | "statistics";

export interface ParsedRevenueEntry {
  clinicName: string; referringVet: string; clientName: string;
  animalName: string; amount: number; date: string; division: string;
}
export interface ParsedStatisticsEntry {
  clinicName: string; lastReferralDate: string | null; totalReferrals12Months: number;
}

export interface ReferralIngestResult {
  ok: boolean;
  error?: string;
  message?: string;
  reportType?: ReportType;
  uploadId?: string;
  updated?: number;
  skipped?: number;
  notMatched?: number;
  revenueAdded?: number;
  visitorsAdded?: number;
  newRows?: number | null;
  totalRows?: number | null;
  invalidDateRows?: number;
  dateRange?: { start: string; end: string } | null;
  details?: Array<{
    clinicName: string; matched: boolean; matchedTo?: string;
    visits: number; revenue: number; lastVisitDate?: string; divisions?: string[];
  }>;
}

interface MatchPartner {
  id: string; name: string; referral_divisions: string[] | null; last_referral_date: string | null;
}

// ===========================================================================
// Pure parsing / matching helpers
// ===========================================================================
export function detectReportType(csvText: string): ReportType {
  const firstLine = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")[0].toLowerCase();
  if (firstLine.includes("clinic name") && firstLine.includes("date of last referral")) return "statistics";
  if (firstLine.includes("date/time") && firstLine.includes("referring vet clinic")) return "revenue";
  return "revenue";
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
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

function parseRevenueCSV(csvText: string): ParsedRevenueEntry[] {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const entries: ParsedRevenueEntry[] = [];
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

function parseRevenueXLS(buffer: Buffer): ParsedRevenueEntry[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  const entries: ParsedRevenueEntry[] = [];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(data.length, 50); i++) {
    const cell = (data[i]?.[0] || "").toString().toLowerCase();
    const cell1 = (data[i]?.[1] || "").toString().toLowerCase();
    if (cell.includes("date/time") && cell1.includes("referring vet clinic")) { headerIdx = i; break; }
  }
  if (headerIdx === -1) headerIdx = 9;
  for (let i = headerIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 2) continue;
    const dateTime = row[0];
    const clinicName = (row[1] || "").toString().trim();
    if (!dateTime || !clinicName) continue;
    if (clinicName.toLowerCase() === "unknown clinic") continue;
    if (clinicName.toLowerCase().startsWith("total")) continue;
    const rawAmount = row[6];
    const amount = typeof rawAmount === "number" ? rawAmount : (parseFloat(String(rawAmount).replace(/[,$]/g, "")) || 0);
    if (amount <= 0) continue;
    entries.push({
      clinicName, referringVet: (row[2] || "").toString().trim(), clientName: (row[3] || "").toString().trim(),
      animalName: (row[4] || "").toString().trim(), amount, date: dateTime.toString().trim(), division: (row[5] || "").toString().trim(),
    });
  }
  return entries;
}

function parseStatisticsCSV(csvText: string): ParsedStatisticsEntry[] {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const entries: ParsedStatisticsEntry[] = [];
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
    let lastReferralDate: string | null = null;
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

function parseEzyVetDate(dateStr: string): string | null {
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

function aggregateRevenueByClinic(entries: ParsedRevenueEntry[]) {
  const clinicMap = new Map<string, { visits: number; revenue: number; lastDate: string | null; divisions: Set<string> }>();
  for (const entry of entries) {
    const existing = clinicMap.get(entry.clinicName) || { visits: 0, revenue: 0, lastDate: null as string | null, divisions: new Set<string>() };
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

function normalizeNameForComparison(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

const GENERIC_WORDS = new Set([
  "the", "and", "for", "of", "at", "in", "vet", "vets", "pet", "pets", "animal", "animals",
  "clinic", "clinics", "hospital", "hospitals", "center", "centre", "medical", "veterinary",
  "care", "health", "wellness", "group", "practice", "dr", "dvm", "inc", "llc", "corp",
]);
function extractKeywords(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 1 && !GENERIC_WORDS.has(w));
}

function findBestMatch(clinicName: string, partners: MatchPartner[]): MatchPartner | null {
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
  let bestMatch: MatchPartner | null = null;
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
// Core ingest — matches clinics to partners, updates partner fields, records
// revenue line items + sync history, and recalculates partner metrics.
// ===========================================================================
export async function ingestReferralBuffer(
  admin: Admin,
  fileBuffer: Buffer,
  opts: { filename: string; uploadedBy?: string | null; dataSource?: string; isXLS?: boolean },
): Promise<ReferralIngestResult> {
  const { filename, uploadedBy = null, dataSource = "csv_upload" } = opts;
  const isXLS = opts.isXLS ?? /\.xlsx?$/.test(filename.toLowerCase());

  let reportType: ReportType;
  let revenueEntries: ParsedRevenueEntry[] = [];
  let statisticsEntries: ParsedStatisticsEntry[] = [];

  if (isXLS) {
    reportType = "revenue";
    revenueEntries = parseRevenueXLS(fileBuffer);
  } else {
    const csvText = fileBuffer.toString("utf-8");
    reportType = detectReportType(csvText);
    if (reportType === "revenue") revenueEntries = parseRevenueCSV(csvText);
    else statisticsEntries = parseStatisticsCSV(csvText);
  }

  const { data: partners } = await fetchAllRows<MatchPartner>((from, to) =>
    admin
      .from("referral_partners")
      .select("id, name, total_referrals_all_time, total_revenue_all_time, last_contact_date, last_referral_date, referral_divisions")
      .range(from, to),
  );
  if (!partners) return { ok: false, error: "Failed to fetch partners", message: "DB error" };

  const result: ReferralIngestResult["details"] = [];
  let updated = 0, skipped = 0, notMatched = 0, revenueAdded = 0, visitorsAdded = 0;

  const contentHash = createHash("sha256").update(fileBuffer).digest("hex");
  const { data: syncRow, error: syncErr } = await admin
    .from("referral_sync_history")
    .insert({
      filename,
      uploaded_by: uploadedBy,
      content_hash: contentHash,
      report_type: reportType,
      data_source: dataSource,
      sync_details: { stage: "started" },
    })
    .select("id")
    .single();
  if (syncErr || !syncRow) return { ok: false, error: syncErr?.message, message: `Failed to record upload: ${syncErr?.message}` };
  const uploadId = syncRow.id as string;

  let newRows: number | null = null;
  let totalRows: number | null = null;
  let invalidDateRows = 0;
  let dateRange: { start: string; end: string } | null = null;

  if (reportType === "revenue") {
    if (revenueEntries.length === 0) {
      return { ok: false, error: "Empty", message: "No valid entries found. Check the file has Date/Time, Referring Vet Clinic and Amount columns." };
    }
    const aggregated = aggregateRevenueByClinic(revenueEntries);
    const clinicToPartner = new Map<string, MatchPartner>();
    for (const agg of aggregated) {
      const m = findBestMatch(agg.clinicName, partners as MatchPartner[]);
      if (m) clinicToPartner.set(agg.clinicName, m);
    }
    const syncDate = new Date().toISOString();
    const partnerUpdates = new Map<string, Record<string, unknown>>();
    for (const agg of aggregated) {
      const m = clinicToPartner.get(agg.clinicName);
      if (!m) {
        notMatched++;
        result.push({ clinicName: agg.clinicName, matched: false, visits: agg.totalVisits, revenue: agg.totalRevenue, lastVisitDate: agg.lastReferralDate || undefined, divisions: agg.divisions });
        continue;
      }
      const existingDivisions = m.referral_divisions || [];
      const mergedDivisions = [...new Set([...existingDivisions, ...agg.divisions])].sort();
      partnerUpdates.set(m.id, {
        referral_divisions: mergedDivisions, last_sync_date: syncDate, last_data_source: dataSource,
      });
      updated++;
      revenueAdded += agg.totalRevenue;
      visitorsAdded += agg.totalVisits;
      result.push({ clinicName: agg.clinicName, matched: true, matchedTo: m.name, visits: agg.totalVisits, revenue: agg.totalRevenue, lastVisitDate: agg.lastReferralDate || undefined, divisions: agg.divisions });
    }
    await mapWithConcurrency([...partnerUpdates], 10, async ([id, patch]) => {
      await admin.from("referral_partners").update(patch).eq("id", id);
    });

    const sortedEntries = [...revenueEntries].sort((a, b) => {
      const aDate = parseEzyVetDate(a.date) || a.date;
      const bDate = parseEzyVetDate(b.date) || b.date;
      return aDate.localeCompare(bDate) || a.clinicName.localeCompare(b.clinicName) || a.clientName.localeCompare(b.clientName) ||
        a.animalName.localeCompare(b.animalName) || (a.amount - b.amount) || a.referringVet.localeCompare(b.referringVet);
    });
    const seqCounters = new Map<string, number>();
    const lineItemRows: Record<string, unknown>[] = [];
    for (const entry of sortedEntries) {
      const parsedDate = parseEzyVetDate(entry.date);
      if (!parsedDate || !/^\d{4}-\d{2}-\d{2}$/.test(parsedDate)) { invalidDateRows++; continue; }
      const partner = clinicToPartner.get(entry.clinicName);
      const seqKey = [parsedDate, entry.clinicName, entry.clientName, entry.animalName, entry.amount.toFixed(2)].join("|");
      const seq = (seqCounters.get(seqKey) ?? 0) + 1;
      seqCounters.set(seqKey, seq);
      const dedupHash = createHash("sha256").update(`${seqKey}|${entry.referringVet}|${seq}`).digest("hex").slice(0, 40);
      lineItemRows.push({
        partner_id: partner?.id || null, transaction_date: parsedDate, csv_clinic_name: entry.clinicName,
        referring_vet: entry.referringVet || null, client_name: entry.clientName || null, animal_name: entry.animalName || null,
        division: entry.division || null, amount: Math.round(entry.amount * 100) / 100, dedup_hash: dedupHash,
        row_index: seq, upload_id: uploadId,
      });
    }

    let inserted = 0;
    for (let i = 0; i < lineItemRows.length; i += 500) {
      const batch = lineItemRows.slice(i, i + 500);
      const { data: ins } = await admin
        .from("referral_revenue_line_items")
        .upsert(batch, { onConflict: "dedup_hash", ignoreDuplicates: true })
        .select("id");
      inserted += ins?.length || 0;
    }
    newRows = inserted;
    totalRows = lineItemRows.length;
    skipped = totalRows - newRows;

    const parsedDates = lineItemRows.map((r) => r.transaction_date as string).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    dateRange = parsedDates.length ? { start: parsedDates[0], end: parsedDates[parsedDates.length - 1] } : null;
  } else {
    if (statisticsEntries.length === 0) {
      return { ok: false, error: "Empty", message: "No valid entries found in Statistics CSV." };
    }
    const syncDate = new Date().toISOString();
    const partnerUpdates = new Map<string, Record<string, unknown>>();
    for (const entry of statisticsEntries) {
      const m = findBestMatch(entry.clinicName, partners as MatchPartner[]);
      if (m) {
        const updateData: Record<string, unknown> = {
          referrals_last_12_months: entry.totalReferrals12Months, last_sync_date: syncDate, last_data_source: dataSource,
        };
        if (entry.lastReferralDate) {
          updateData.last_contact_date = entry.lastReferralDate;
          const existing = m.last_referral_date ? String(m.last_referral_date).split("T")[0] : null;
          if (!existing || entry.lastReferralDate > existing) updateData.last_referral_date = entry.lastReferralDate;
        }
        partnerUpdates.set(m.id, updateData);
        updated++;
        visitorsAdded += entry.totalReferrals12Months;
        result.push({ clinicName: entry.clinicName, matched: true, matchedTo: m.name, visits: entry.totalReferrals12Months, revenue: 0, lastVisitDate: entry.lastReferralDate || undefined });
      } else {
        notMatched++;
        result.push({ clinicName: entry.clinicName, matched: false, visits: entry.totalReferrals12Months, revenue: 0, lastVisitDate: entry.lastReferralDate || undefined });
      }
    }
    await mapWithConcurrency([...partnerUpdates], 10, async ([id, patch]) => {
      await admin.from("referral_partners").update(patch).eq("id", id);
    });
    const statsDates = statisticsEntries.map((e) => e.lastReferralDate).filter((d): d is string => !!d).sort();
    dateRange = statsDates.length ? { start: statsDates[0], end: statsDates[statsDates.length - 1] } : null;
  }

  await admin.from("referral_sync_history").update({
    date_range_start: dateRange?.start || null,
    date_range_end: dateRange?.end || null,
    total_rows_parsed: totalRows ?? result.length,
    total_rows_matched: updated,
    total_rows_skipped: skipped,
    total_revenue_added: revenueAdded,
    sync_details: { reportType, notMatched, visitorsAdded, newRows, clinicDetails: result },
  }).eq("id", uploadId);

  await admin.rpc("recalculate_partner_metrics");

  return {
    ok: true, reportType, uploadId,
    updated, skipped, notMatched,
    revenueAdded: Math.round(revenueAdded * 100) / 100, visitorsAdded,
    newRows, totalRows, invalidDateRows, dateRange, details: result,
  };
}
