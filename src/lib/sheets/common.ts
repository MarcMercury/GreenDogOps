import "server-only";

/** One thing the sync refused to decide on its own; lands in sheet_sync_issue. */
export interface SyncIssue {
  kind: string;
  subject: string;
  detail: Record<string, unknown>;
}

/** Per-source outcome. Shaped to render in Admin ▸ Agents run detail. */
export interface SheetSyncResult {
  parsed: number;
  inserted: number;
  updated: number;
  issues: SyncIssue[];
  notes: Record<string, unknown>;
}

export const emptyResult = (): SheetSyncResult => ({
  parsed: 0,
  inserted: 0,
  updated: 0,
  issues: [],
  notes: {},
});

/** Collapse whitespace; null/undefined become "". */
export const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/** Cell at `i`, or "" when the row is short (sheet rows are ragged). */
export const cell = (row: string[] | undefined, i: number): string =>
  i >= 0 && row ? clean(row[i]) : "";

/**
 * Comparison key for a person's display name: drops honorifics, parenthetical
 * nicknames, trailing dedupe digits and punctuation. Must stay in step with
 * greendogops.normalize_person_key().
 */
export function nameKey(name: unknown): string {
  return clean(name)
    .replace(/\d+\s*$/, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bdr\.?\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Spreadsheet formula errors must never reach the database. */
export const isFormulaError = (v: unknown): boolean =>
  /^#(N\/A|REF|VALUE|NAME|DIV\/0|NULL)/i.test(clean(v));

/** "$1,640.00" / "(250)" -> number; anything non-numeric -> null. */
export function parseMoney(v: unknown): number | null {
  const s = clean(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  const n = Number(negative ? s.slice(1, -1) : s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** "7/13/2020" / "2020-07-13" -> "YYYY-MM-DD"; anything else -> null. */
export function parseSheetDate(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return isoOrNull(+iso[1], +iso[2], +iso[3]);

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (us) {
    // Two-digit years in this workbook are all 20xx (earliest hire is 2015).
    const yr = +us[3] < 100 ? 2000 + +us[3] : +us[3];
    return isoOrNull(yr, +us[1], +us[2]);
  }
  return null;
}

function isoOrNull(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100)) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** TRUE/YES/1 -> true, FALSE/NO/0 -> false, anything else (N/A, "") -> null. */
export function parseBool(v: unknown): boolean | null {
  const s = clean(v).toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return null;
}

/** Plain number, or null. Used for counts like "Days Per Week". */
export function parseNumber(v: unknown): number | null {
  const s = clean(v);
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Today in America/Los_Angeles as YYYY-MM-DD (the clinics' operating day). */
export function todayLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
