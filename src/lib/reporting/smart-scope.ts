import { isAdminRole, type AppRole } from "@/lib/auth/permissions";

// ---------------------------------------------------------------------------
// Smart Report data scope.
//
// The Smart Report runs the model's SQL through greendogops.smart_query(),
// which is a SERVICE-ROLE function: it bypasses RLS and can read every table in
// the schema. Now that the feature is open to everyone above Staff, the caller's
// role has to be turned into an explicit deny-list, applied in three places
// (see smart.ts):
//   1. the schema catalog handed to the model omits what it may not read,
//   2. the generated SQL is rejected if it names a blocked table/column,
//   3. blocked keys are stripped from the returned rows (catches `select *`).
// ---------------------------------------------------------------------------

export type SmartTier = "full" | "hr" | "basic";

export interface SmartScope {
  tier: SmartTier;
  /** Pay, wage and benefit figures — Owner/Admin/Executive only. */
  canViewCompensation: boolean;
  /** Confidential employee files (documents, reviews, discipline, licences). */
  canViewHrRecords: boolean;
  /** Table names the query may not touch, lower-case. */
  blockedTables: readonly string[];
  /** Column names the query may not return, lower-case. */
  blockedColumns: readonly string[];
}

/**
 * Employee pay, wage and benefit columns. All of them live on
 * person_employment and none of these names is used by any other table, so a
 * bare-identifier match is unambiguous.
 */
const COMPENSATION_COLUMNS = [
  "pay_type",
  "current_rate",
  "previous_rate",
  "latest_wage_change_date",
  "biweekly_wage",
  "annual_wages",
  "benefits_enrolled",
  "benefits_monthly",
  "benefits_annual",
  "ce_budget",
  "ce_used",
  "ce_remaining",
] as const;

/**
 * The confidential employee file. Schedule/Marketing Admins keep `person`
 * (roster names, titles, status), `person_time_off` and `person_pto_day`
 * because those already drive the schedule and calendar they administer.
 */
const HR_RECORD_TABLES = [
  "person_employment",
  "person_document",
  "person_review",
  "person_disciplinary_action",
  "person_interview",
  "person_recruiting",
  "person_compliance_entry",
  "person_license",
  "person_asset",
  "person_onboarding_item",
  "ats_hr_merge_backup_0032",
] as const;

/** Stored third-party logins — never an answer to a reporting question. */
const ALWAYS_BLOCKED_TABLES = ["credential"] as const;

/**
 * Compensation is deliberately gated on Owner/Admin/Executive rather than
 * `canViewAllCompensation` (which also covers Manager/HR): the Smart Report can
 * aggregate everyone's pay in one question, so it is held to a tighter bar than
 * the per-employee HR profile.
 */
export function smartScopeFor(role: AppRole): SmartScope {
  const tier: SmartTier =
    isAdminRole(role) || role === "executive"
      ? "full"
      : role === "manager"
        ? "hr"
        : "basic";

  const canViewCompensation = tier === "full";
  const canViewHrRecords = tier !== "basic";

  return {
    tier,
    canViewCompensation,
    canViewHrRecords,
    blockedTables: [
      ...ALWAYS_BLOCKED_TABLES,
      ...(canViewHrRecords ? [] : HR_RECORD_TABLES),
    ],
    blockedColumns: canViewCompensation ? [] : [...COMPENSATION_COLUMNS],
  };
}

/** Sentence appended to the model's system prompt so it stops asking. */
export function scopeNotice(scope: SmartScope): string {
  const lines: string[] = [];
  if (!scope.canViewCompensation) {
    lines.push(
      "This user may NOT see employee pay, wages, rates, or benefit amounts. Never select or " +
        "derive pay_type, current_rate, previous_rate, biweekly_wage, annual_wages, ce_budget or " +
        "any benefits_* column, and never write `select *` from person_employment.",
    );
    lines.push(
      "The same applies to the policy excerpts: you may describe how compensation is STRUCTURED " +
        "or reviewed, but never quote a specific pay rate, wage, salary band or bonus figure from " +
        "a document.",
    );
  }
  if (!scope.canViewHrRecords) {
    lines.push(
      "This user may NOT see confidential employee records (employment terms, documents, " +
        "performance reviews, disciplinary actions, interviews, licences, recruiting notes). " +
        "Roster basics on `person`, plus time off and the schedule tables, are still available.",
    );
  }
  if (!lines.length) return "";
  return `\nAccess restrictions for the person asking (these tables/columns are NOT in the schema listing below — do not invent them):\n${lines
    .map((l) => `- ${l}`)
    .join("\n")}\nIf the question needs data they cannot see, set "sql" to null and say so in "answer".\n`;
}

/** Strip SQL comments and string literals so identifier matching can't be fooled. */
function sqlIdentifiers(sql: string): Set<string> {
  const bare = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, " ")
    .replace(/"/g, " ")
    .toLowerCase();
  return new Set(bare.match(/[a-z_][a-z0-9_]*/g) ?? []);
}

/**
 * The first blocked table/column the query names, or null when it is clean.
 * Returned to the model as a query error so it can rewrite within its scope.
 */
export function blockedIdentifier(sql: string, scope: SmartScope): string | null {
  if (!scope.blockedTables.length && !scope.blockedColumns.length) return null;
  const used = sqlIdentifiers(sql);
  for (const name of scope.blockedTables) if (used.has(name)) return name;
  for (const name of scope.blockedColumns) if (used.has(name)) return name;
  return null;
}

/**
 * Last line of defence: drop blocked keys from the rows before they reach the
 * summariser or the browser. `select *` on an allowed table can still surface a
 * blocked column without ever naming it.
 */
export function scrubRows<T extends Record<string, unknown>>(
  rows: T[],
  scope: SmartScope,
): T[] {
  if (!scope.blockedColumns.length) return rows;
  const blocked = new Set(scope.blockedColumns);
  let hit = false;
  const out = rows.map((row) => {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (blocked.has(key.toLowerCase())) {
        hit = true;
        continue;
      }
      clean[key] = value;
    }
    return clean as T;
  });
  return hit ? out : rows;
}
