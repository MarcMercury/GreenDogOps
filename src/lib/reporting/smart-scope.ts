import { canAccessModule, isAdminRole, type AppRole, type AppUser } from "../auth/permissions";

// ---------------------------------------------------------------------------
// Ask Ziggy data scope (the engine is still called "Smart Report" in code).
//
// Ask Ziggy runs the model's SQL through greendogops.smart_query(), which is a
// SERVICE-ROLE function: it bypasses RLS and can read every table in the
// schema. It is open to every employee, so the caller's role has to be turned
// into an explicit deny-list, applied in three places (see smart.ts):
//   1. the schema catalog handed to the model omits what it may not read,
//   2. the generated SQL is rejected if it names a blocked table/column,
//   3. blocked keys are stripped from the returned rows (catches `select *`).
// ---------------------------------------------------------------------------

export type SmartTier = "full" | "hr" | "basic" | "general";

export interface SmartScope {
  tier: SmartTier;
  /** Pay, wage and benefit figures — Owner/Admin/Executive only. */
  canViewCompensation: boolean;
  /** Confidential employee files (documents, reviews, discipline, licences). */
  canViewHrRecords: boolean;
  /**
   * Revenue REPORTING: totals by location, period, doctor or service line, and
   * the raw billing tables behind them. Without it a user can still look up
   * retail prices and what ONE client or patient was charged (the
   * literal-argument lookups below).
   */
  canViewFinancials: boolean;
  /**
   * Deny-by-default list for the general tier: the ONLY tables, views and
   * functions the query may use. null means "everything not blocked". Turned
   * into blockedTables against the live catalog by withCatalog().
   */
  allowedTables: readonly string[] | null;
  /**
   * Functions this user may only call with ONE quoted-string argument
   * (`client_visits('Jane Smith')`), at most MAX_LOOKUP_CALLS per query, so a
   * per-client lookup can never be joined across every client into a revenue
   * report. Empty = no restriction.
   */
  literalArgFunctions: readonly string[];
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
  // Policy acknowledgements (initials + date) are part of the employee file.
  "resource_document_signature",
] as const;

/**
 * Resources documents can be limited to roles or named people (0235). Ask Ziggy
 * reads their text through search_resource_content(), which applies that rule
 * for the asker; raw SQL on these tables would not, so only the tiers that may
 * view every document (HR / Manager and above) can query them.
 */
const RESTRICTED_DOCUMENT_TABLES = [
  "resource_document",
  "resource_document_chunk",
  "resource_document_viewer",
] as const;

/**
 * Never an answer to a reporting question, for any role: stored logins and
 * OAuth tokens, each user's private dashboard data (0230), text messages and
 * consent (0228), Slack account links (0229), security logs, other users'
 * Smart Report questions, and one-off backup tables. smart-scope.test.ts fails
 * if a service-role-only table in the baseline is missing from this list.
 */
export const ALWAYS_BLOCKED_TABLES = [
  "credential",
  "recruiter_google_token",
  "ops_task",
  "user_notification",
  "notification_delivery",
  "notification_event",
  "notification_rule",
  "notification_action",
  "reminder_rule",
  "reminder_ack",
  "sms_message",
  "sms_consent",
  "sms_opt_out",
  "person_slack_link",
  "audit_log",
  "rate_limit_bucket",
  "smart_question_log",
  "person_recruiting_cleanup_0220",
  "person_recruiting_score_backup_0225",
  // Full snapshots of every policy version, including restricted ones.
  "resource_document_version",
] as const;

/**
 * smart_query() runs as the service role, which can also read other schemas —
 * including EmployeeGM's `public` tables. Only greendogops is in scope, so a
 * query that qualifies a name with any of these schemas is rejected.
 */
export const FOREIGN_SCHEMAS = [
  "public",
  "auth",
  "vault",
  "storage",
  "realtime",
  "extensions",
  "graphql",
  "graphql_public",
  "information_schema",
  "pg_catalog",
] as const;

/**
 * Everything a general employee (Staff) may ask Ask Ziggy about: patients and
 * their owners' contact details, vaccinations, appointments, the schedule and
 * staff directory, the medical boards, the calendar, planning guides, retail
 * prices, and what ONE client or patient was charged — across every location.
 * What they cannot do is revenue REPORTING (totals by location, date, doctor).
 *
 * It is an ALLOW-list, and every entry must be safe to read IN FULL. Column
 * blocking cannot protect a table here: `to_jsonb(t)`, `t::text` or
 * `array_agg(t)` return a whole row without naming a single column. So
 * ezyvet_contact, ezyvet_invoice_line and person stay out; the views and
 * bounded lookup functions from migration 0233 expose the safe parts.
 * smart-scope.test.ts checks every entry exists and carries no revenue/cost.
 */
export const GENERAL_ALLOWED_TABLES = [
  // Patients and clinical activity (ezyVet)
  "ezyvet_animal",
  "ezyvet_vaccination",
  "ezyvet_clinical_note",
  "ezyvet_soc_overdue",
  "ezyvet_tag",
  "ezyvet_record_tag",
  // Appointments
  "ezyvet_appointment_record",
  "ezyvet_appointment_status",
  "ezyvet_agenda_appt_snapshot",
  "ezyvet_agenda_snapshot",
  "ezyvet_agenda_count",
  "ezyvet_agenda_dept_map",
  "ezyvet_appt_type_dept_map",
  "ezyvet_cancelled_appointment",
  "report_appointment_detail",
  "report_appointment_type_volume",
  "report_appointment_type_by_species",
  "report_appointment_flow",
  "report_animal_summary",
  "report_animals_by_species",
  "report_soc_overdue_current",
  "report_clinical_note_backlog",
  // Appointment functions (counts only, no money)
  "appointment_review",
  "appointment_review_by_type",
  "appointment_review_detail",
  "appointment_review_type_detail",
  "appt_type_observed_counts",
  "cancelled_appointments_by_type",
  "cancelled_appointments_detail",
  "upcoming_appointment_demand",
  "medical_board_coverage",
  // Retail prices, directory and roster (0233 views)
  "product_catalog",
  "staff_directory",
  "schedule_roster",
  // One client / one patient (0233); literal argument only, see GENERAL_LOOKUP_FUNCTIONS
  "client_summary",
  "client_visits",
  "patient_visits",
  // Locations, schedule grid, boards, calendar, planning
  "location",
  "sched_week",
  "sched_week_line",
  "sched_week_location",
  "sched_shift_template",
  "sched_role",
  "sched_department",
  "sched_closure",
  "sched_event",
  "medical_board_type",
  "medical_board_day",
  "medical_board_row",
  "calendar_event",
  "planning_guide",
  "planning_guide_column",
  "planning_guide_slot",
  "planning_capacity_rule",
] as const;

/**
 * Per-client / per-patient lookups (migration 0233). Each call resolves to at
 * most 10 clients or patients in the database; for the General tier they must
 * also be called with a literal argument, so a query cannot feed them every
 * client code from a join and sum the result into revenue.
 */
export const GENERAL_LOOKUP_FUNCTIONS = ["client_summary", "client_visits", "patient_visits"] as const;
export const MAX_LOOKUP_CALLS = 3;

/**
 * Built-in functions that read data the identifier check cannot see, for EVERY
 * tier. query_to_xml / ts_stat / ts_rewrite execute SQL passed as a string
 * literal — and literals are stripped before identifiers are matched — so
 * `query_to_xml('select * from person_employment', ...)` would walk straight
 * past the table block. table_to_xml and ::regclass name a table as a string.
 * The pg_ catalog (pg_stat_activity, pg_proc, ...) and large objects are never
 * a reporting answer.
 */
function unsafeFunction(identifier: string): boolean {
  return (
    identifier.startsWith("pg_") ||
    identifier.startsWith("lo_") ||
    identifier.includes("_to_xml") ||
    /^(to_)?reg(class|proc|procedure|oper|operator|type|namespace|role|collation|config|dictionary)$/.test(
      identifier,
    ) ||
    identifier === "ts_stat" ||
    identifier === "ts_rewrite" ||
    identifier.startsWith("dblink")
  );
}

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
        : role === "staff"
          ? "general"
          : "basic";

  const canViewCompensation = tier === "full";
  const canViewHrRecords = tier === "full" || tier === "hr";

  return {
    tier,
    canViewCompensation,
    canViewHrRecords,
    canViewFinancials: tier !== "general",
    allowedTables: tier === "general" ? GENERAL_ALLOWED_TABLES : null,
    literalArgFunctions: tier === "general" ? GENERAL_LOOKUP_FUNCTIONS : [],
    blockedTables: [
      ...ALWAYS_BLOCKED_TABLES,
      ...(canViewHrRecords ? [] : [...HR_RECORD_TABLES, ...RESTRICTED_DOCUMENT_TABLES]),
    ],
    blockedColumns: canViewCompensation ? [] : [...COMPENSATION_COLUMNS],
  };
}

/**
 * The scope for a signed-in user. A Staff member who has been granted the
 * Reporting module already sees revenue on the Reporting pages, so Ask Ziggy
 * gives them the same "basic" scope as the other non-HR roles.
 */
export function scopeForUser(user: AppUser): SmartScope {
  if (user.role === "staff" && canAccessModule(user, "reporting")) {
    return smartScopeFor("schedule_admin");
  }
  return smartScopeFor(user.role);
}

/**
 * Resolve an allow-list scope against the live catalog: every table, view and
 * function the database exposes that is NOT allowed becomes blocked, so the
 * three existing layers (catalog filter, identifier check, row scrub) enforce
 * it without knowing about allow-lists. A new table is therefore invisible to
 * the general tier until someone adds it to GENERAL_ALLOWED_TABLES.
 */
export function withCatalog(scope: SmartScope, catalogNames: readonly string[]): SmartScope {
  if (!scope.allowedTables) return scope;
  const allowed = new Set(scope.allowedTables.map((n) => n.toLowerCase()));
  const extra = catalogNames.map((n) => n.toLowerCase()).filter((n) => !allowed.has(n));
  return { ...scope, blockedTables: [...new Set([...scope.blockedTables, ...extra])] };
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
  if (!scope.canViewFinancials) {
    lines.push(
      "This user may NOT run revenue reporting: no totals or rankings of revenue, sales or billing " +
        "by location, date, period, doctor, service line or product across clients. Only the tables " +
        "and functions in the schema listing below are available.",
    );
    lines.push(
      "They MAY look up individual prices and individual clients: product_catalog has the retail " +
        "price of every product/service per division (hospital); client_summary('<client name or " +
        "contact code>') gives one client's details, pets and spend; client_visits('<client>') and " +
        "patient_visits('<animal_code or pet name>') list every billed item with date, vet and " +
        "charge — filter visit_date for one visit, item_group for dental/medications. Call these " +
        "three with ONE plain quoted string literal (never a column, subquery or cast), at most " +
        `${MAX_LOOKUP_CALLS} calls per query. If a name matches more than 10, the function errors: ` +
        "find the right client/patient first (ezyvet_animal has owner names and animal_code).",
    );
    lines.push(
      "Employee names are in staff_directory and who works when in schedule_roster. Questions " +
        "about the asker's OWN shifts, time off or PTO are answered from the \"About the person " +
        "asking\" section instead of SQL.",
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
    .join("\n")}\nIf the question needs data they cannot see, set "sql" to null, "source" to "restricted", and say in "answer", in plain words without mentioning SQL, queries or table names, that the information is not available at their access level.\n`;
}

/** Strip SQL comments and string literals so identifier matching can't be fooled. */
function sqlIdentifiers(sql: string): Set<string> {
  return new Set(sqlCode(sql).match(/[a-z_][a-z0-9_]*/g) ?? []);
}

/** Strip comments and literals, keeping `.` so schema qualifiers stay visible. */
function sqlCode(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, " ")
    .replace(/"/g, " ")
    .toLowerCase();
}

/**
 * The first blocked table/column the query names, or null when it is clean.
 * Returned to the model as a query error so it can rewrite within its scope.
 */
export function blockedIdentifier(sql: string, scope: SmartScope): string | null {
  const code = sqlCode(sql);
  for (const schema of FOREIGN_SCHEMAS) {
    if (new RegExp(`(^|[^a-z0-9_$])${schema}\\s*\\.`).test(code)) return `${schema} schema`;
  }
  const used = sqlIdentifiers(sql);
  for (const name of used) if (unsafeFunction(name)) return name;
  if (!scope.blockedTables.length && !scope.blockedColumns.length) return null;
  for (const name of scope.blockedTables) if (used.has(name)) return name;
  for (const name of scope.blockedColumns) if (used.has(name)) return name;
  return null;
}

/** Index just past a '...' literal starting at `start` ('' is an escaped quote). */
function skipLiteral(sql: string, start: number): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

function skipSpace(sql: string, i: number): number {
  while (i < sql.length && /\s/.test(sql[i])) i += 1;
  return i;
}

/**
 * Why a query misuses a literal-argument lookup function, or null. Walks the
 * SQL skipping comments and string literals; every reference to one of
 * `scope.literalArgFunctions` must be `name('plain literal')`.
 */
export function lookupCallProblem(sql: string, scope: SmartScope): string | null {
  const names = new Set(scope.literalArgFunctions);
  if (!names.size) return null;
  let calls = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (ch === "'") {
      i = skipLiteral(sql, i);
      continue;
    }
    let ident: string | null = null;
    if (ch === '"') {
      const end = sql.indexOf('"', i + 1);
      ident = sql.slice(i + 1, end < 0 ? n : end).toLowerCase();
      i = end < 0 ? n : end + 1;
    } else if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j += 1;
      ident = sql.slice(i, j).toLowerCase();
      i = j;
    } else {
      i += 1;
      continue;
    }
    if (!names.has(ident)) continue;

    const usage = `${ident}('Jane Smith')`;
    let k = skipSpace(sql, i);
    if (sql[k] !== "(") return `${ident} can only be called as ${usage}, with one quoted name or code.`;
    k = skipSpace(sql, k + 1);
    if (sql[k] !== "'") return `${ident} needs one plain quoted name or code, e.g. ${usage} — not a column, subquery or expression.`;
    k = skipSpace(sql, skipLiteral(sql, k));
    if (sql[k] !== ")") return `${ident} takes exactly one plain quoted name or code, e.g. ${usage}.`;
    i = k + 1;
    calls += 1;
    if (calls > MAX_LOOKUP_CALLS) {
      return `At most ${MAX_LOOKUP_CALLS} client/patient lookups per question. Ask about fewer clients at a time.`;
    }
  }
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
