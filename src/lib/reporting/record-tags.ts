import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseCsv, clean, normalizeHeader } from "./parse";
import type { CsvIngestResult } from "./agent-ingest";

/**
 * ezyVet's own cap on one Records-dashboard export. A payload larger than this
 * cannot have come from a working tag filter — the likeliest cause is a filter
 * that silently matched every record — so it is refused rather than recorded
 * as "everyone carries this tag".
 */
const MAX_TAGGED_RECORDS = 10_000;

export type RecordTagMode = "backfill" | "incremental";

export type RecordTagMeta = {
  tagKey: string;
  tagLabel: string;
  tagType?: string;
  tagGroup?: string | null;
  /** 'contact' = a Contacts export, 'animal' = a Pets export. */
  recordType: "contact" | "animal";
  mode: RecordTagMode;
  /** Start of the activity window; required for an incremental run. */
  activityFrom?: string | null;
  runOn?: string | null;
};

export type RecordTagResult = CsvIngestResult & {
  matched?: number;
  added?: number;
  confirmed?: number;
  removed?: number;
};

/** Today in Los Angeles (the practice's clock), as YYYY-MM-DD. */
function todayLA(): string {
  const la = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, "0")}-${String(la.getDate()).padStart(2, "0")}`;
}

/** First header present out of `names`, by normalized comparison. */
function pickColumn(idx: Map<string, number>, names: string[]): number | undefined {
  for (const name of names) {
    const at = idx.get(normalizeHeader(name));
    if (at != null) return at;
  }
  return undefined;
}

export type RecordTagWork = {
  tag_key: string;
  tag_label: string;
  tag_type: string;
  tag_group: string | null;
  record_type: "contact" | "animal";
  backfilled_on: string | null;
};

/**
 * The tags a run should cover.
 *
 * An incremental run deliberately skips tags with no backfill: a windowed pull
 * on a tag that has never been read in full would store the handful of
 * recently-touched records as if they were the entire population, and every
 * report built on it would understate the tag by orders of magnitude. Those
 * tags stay out of the nightly run until a backfill gives them a baseline.
 */
export async function listRecordTagsToRun(
  mode: RecordTagMode,
): Promise<{ ok: true; mode: RecordTagMode; tags: RecordTagWork[] } | { ok: false; error: string }> {
  const admin = createAdminClient();
  let query = admin
    .from("ezyvet_tag")
    .select("tag_key, tag_label, tag_type, tag_group, record_type, backfilled_on")
    .eq("is_active", true)
    .order("tag_label");
  if (mode === "incremental") query = query.not("backfilled_on", "is", null);

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, mode, tags: (data ?? []) as RecordTagWork[] };
}

/**
 * Ingest the CSV exported from Dashboard ▸ Records with one tag filter applied.
 *
 * Only identity columns are read: the export carries the full Contacts/Pets
 * layout, but ezyvet_contact and ezyvet_animal already hold every other field
 * and re-storing them here would create a second, staler copy of the record.
 *
 * The write is a MERGE (greendogops.merge_record_tag) rather than a replace,
 * because an incremental run only reads records with recent activity — see
 * migration 0198 for why replacing would empty the membership.
 */
export async function ingestRecordTagCsv(
  text: string,
  meta: RecordTagMeta,
): Promise<RecordTagResult> {
  if (meta.mode === "incremental" && !meta.activityFrom) {
    return {
      ok: false,
      error: "An incremental run needs activity_from.",
      parsed: 0,
      inserted: 0,
      skipped: 0,
    };
  }

  const grid = parseCsv(text);
  if (grid.length < 2) {
    return { ok: false, error: "Export appears to be empty.", parsed: 0, inserted: 0, skipped: 0 };
  }

  const idx = new Map<string, number>();
  grid[0].forEach((h, i) => idx.set(normalizeHeader(h), i));

  const isAnimal = meta.recordType === "animal";
  // The Pets export keys on Animal Code, the Contacts export on Contact Code.
  const codeCol = pickColumn(idx, isAnimal ? ["Animal Code", "Animal Id"] : ["Contact Code", "Contact Id"]);
  if (codeCol == null) {
    return {
      ok: false,
      error: isAnimal
        ? 'Missing "Animal Code" — is this a Pets export?'
        : 'Missing "Contact Code" — is this a Contacts export?',
      parsed: 0,
      inserted: 0,
      skipped: 0,
    };
  }

  const contactIdCol = pickColumn(idx, ["Contact Id"]);
  const ownerCodeCol = pickColumn(idx, isAnimal ? ["Owner Contact Code"] : ["Contact Code"]);
  const emailCol = pickColumn(idx, ["Email Addresses", "Home Email Address"]);
  const nameCol = pickColumn(idx, ["Animal Name"]);
  const firstCol = pickColumn(idx, [isAnimal ? "Owner First Name" : "Contact First Name"]);
  const lastCol = pickColumn(idx, [isAnimal ? "Owner Last Name" : "Contact Last Name"]);
  const businessCol = pickColumn(idx, ["Business Name"]);
  const at = (row: string[], c: number | undefined) => (c == null ? null : clean(row[c]));

  const seen = new Set<string>();
  const records: Record<string, unknown>[] = [];
  let skipped = 0;

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (row.length === 1 && row[0].trim() === "") continue;
    const code = at(row, codeCol);
    if (!code || seen.has(code)) {
      skipped++;
      continue;
    }
    seen.add(code);
    const first = at(row, firstCol);
    const last = at(row, lastCol);
    const business = at(row, businessCol);
    const personName = [first, last].filter(Boolean).join(" ").trim() || business;
    records.push({
      record_code: code,
      record_name: isAnimal ? at(row, nameCol) : personName,
      contact_code: isAnimal ? at(row, ownerCodeCol) : code,
      ezyvet_contact_id: isAnimal ? null : at(row, contactIdCol),
      email: at(row, emailCol),
    });
  }

  if (records.length > MAX_TAGGED_RECORDS) {
    return {
      ok: false,
      error: `${records.length} records for tag "${meta.tagLabel}" exceeds the ${MAX_TAGGED_RECORDS} cap — the tag filter looks like it was not applied.`,
      parsed: records.length,
      inserted: 0,
      skipped,
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("merge_record_tag", {
    p_tag_key: meta.tagKey,
    p_tag_label: meta.tagLabel,
    p_record_type: meta.recordType,
    p_mode: meta.mode,
    p_run_on: meta.runOn || todayLA(),
    p_records: records,
    p_tag_type: meta.tagType ?? "pet_tag",
    p_tag_group: meta.tagGroup ?? null,
    p_activity_from: meta.activityFrom ?? null,
  });
  if (error) {
    return { ok: false, error: error.message, parsed: records.length, inserted: 0, skipped };
  }

  const counts = (data ?? {}) as {
    matched?: number;
    added?: number;
    confirmed?: number;
    removed?: number;
  };
  return {
    ok: true,
    parsed: records.length,
    inserted: counts.added ?? 0,
    skipped,
    matched: counts.matched ?? 0,
    added: counts.added ?? 0,
    confirmed: counts.confirmed ?? 0,
    removed: counts.removed ?? 0,
  };
}
