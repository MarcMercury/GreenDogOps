import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { callTextLLM, hasLlmProvider, unwrapJson } from "@/lib/ai/llm";

type AdminClient = ReturnType<typeof createAdminClient>;

// ---------------------------------------------------------------------------
// Smart Report — ask a plain-English question, get an answer from live data.
//
// Pipeline: schema catalog -> LLM writes ONE read-only SELECT -> the
// greendogops.smart_query() RPC runs it (service_role only, STABLE, keyword
// guarded) -> LLM turns the returned rows into a sentence. A failed query is
// fed back to the model so it can correct itself.
// ---------------------------------------------------------------------------

export type SmartRow = Record<string, unknown>;

export interface SmartTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SmartAttempt {
  sql: string;
  error: string;
}

export interface SmartResult {
  ok: boolean;
  answer: string;
  sql: string | null;
  rows: SmartRow[];
  columns: string[];
  rowCount: number;
  truncated: boolean;
  provider: string | null;
  attempts: SmartAttempt[];
}

/** Rows requested from the database for one question. */
const ROW_LIMIT = 200;
/** Rows handed back to the model when it writes the prose answer. */
const ROWS_IN_PROMPT = 60;
const MAX_SQL_ATTEMPTS = 4;
/** How many of those attempts may be spent re-writing a query that ran but found nothing. */
const MAX_EMPTY_RETRIES = 1;
const SCHEMA_TTL_MS = 10 * 60 * 1000;

type CatalogTable = {
  name: string;
  kind: string;
  rows: number | null;
  columns: { name: string; type: string }[];
};

type ValueHint = { table: string; column: string; values: string[] };

let catalogCache: { schema: string; values: string; at: number } | null = null;

function rowLabel(rows: number | null): string {
  if (rows === null || rows === undefined || rows < 0) return "";
  if (rows === 0) return ", empty";
  if (rows >= 1000) return `, ~${Math.round(rows / 1000)}k rows`;
  return `, ~${rows} rows`;
}

/**
 * Compact `table [kind, ~N rows](col type, ...)` listing of everything the query
 * can touch, plus the real vocabulary of every low-cardinality text column.
 *
 * The values matter as much as the names: the model used to guess literals
 * (`species = 'Dog'`) that match nothing, because ezyVet stores
 * `'Canine (dog)'`. Both come from cached RPCs so this costs one round trip
 * every 10 minutes.
 */
async function getSchemaCatalog(admin: AdminClient): Promise<{ schema: string; values: string }> {
  if (catalogCache && Date.now() - catalogCache.at < SCHEMA_TTL_MS) {
    return { schema: catalogCache.schema, values: catalogCache.values };
  }
  const [{ data, error }, hints] = await Promise.all([
    admin.rpc("smart_schema"),
    admin.rpc("smart_value_hints"),
  ]);
  if (error) throw new Error(`Could not read the database schema: ${error.message}`);

  const tables = (data ?? []) as CatalogTable[];
  const schema = tables
    .map(
      (t) =>
        `${t.name} [${t.kind}${rowLabel(t.rows)}](${t.columns
          .map((c) => `${c.name} ${c.type}`)
          .join(", ")})`,
    )
    .join("\n");

  // A failure here must not break the report — the vocabulary is a bonus.
  const values = ((hints.data ?? []) as ValueHint[])
    .filter((h) => h.values?.length)
    .map((h) => `${h.table}.${h.column} = ${h.values.join(" | ")}`)
    .join("\n");

  catalogCache = { schema, values, at: Date.now() };
  return { schema, values };
}

const DOMAIN_NOTES = `Domain notes (Green Dog Veterinary — three Los Angeles hospitals):
- ezyvet_invoice_line = every billed line. Revenue = sum(total_incl) (total_excl is pre-tax).
  Use line_date for "when the service happened" and invoice_date for billing date.
  location_key is one of sherman_oaks, van_nuys, venice, other. case_owner is the
  case-owning doctor; staff_member is who rang the line up. ~250k rows, so always aggregate.
- ezyvet_animal = PATIENTS (pets), ~41k rows, one per pet, refreshed nightly from ezyVet.
  Nearly every patient HAS a date_of_birth — if an age query comes back null the filter is
  wrong, not the data. Age in years = extract(year from age(current_date, date_of_birth));
  the text column "age" is an ezyVet display label like '5y 3m', never do maths on it.
  species is stored with the ezyVet label, e.g. 'Canine (dog)', 'Feline (cat)',
  'Lagomorph (Rabbit)' — dogs are species ilike '%canine%' or ilike '%dog%', cats are
  ilike '%feline%' or ilike '%cat%'. NEVER write species = 'Dog'.
  sex is 'Male Neutered' / 'Female Spayed' / 'Male' / 'Female' / 'Unknown Sex'.
  division is the hospital ('Green Dog - Sherman Oaks', 'Green Dog - Van Nuys',
  'Green Dog - Venice (BU)', 'GDD & MPMV'). breed, weight_lb, last_visit,
  next_appointment, vaccination dates and master_problems are all populated.
  has_passed_away / is_active flag inactive patients. owner_contact_code links to
  ezyvet_contact.contact_code.
- ezyvet_contact = CLIENTS (pet owners) and other contacts. is_customer marks real clients,
  is_business marks companies, is_vet marks referring vets. last_name/first_name/full_name.
- ezyvet_appointment (matview) = one row per client visit day: client_contact_code,
  service_date, location_key, revenue, pet_count. Best source for appointment/visit counts.
  An appointment is NOT a line count — never count invoice lines to answer "how many appointments".
- report_* views/matviews are pre-aggregated roll-ups that encode the practice's official
  definitions. ALWAYS prefer them when one matches the question, otherwise the number will
  disagree with what the Reporting page shows. Their "month" column is a DATE (first of the
  month), not an integer, e.g. month = date '2026-06-01'.
- person = staff/roster and recruiting candidates; person.status tells them apart
  ('employee', 'contractor', 'former', 'applicant', 'prospect') — always filter it, the table is
  mostly applicants. person_employment holds hire_date, pay, PTO, adp_job_title (the real job
  title; offer_title is the offer letter) and location_id -> sched_location.
  Job titles are free text, so identify DOCTORS by their schedule role instead:
  sched_role_member -> sched_role where name ilike '%dvm%' (15 people), and technicians/CSRs the
  same way. sched_* tables hold the published staff schedule (sched_assignment.status='published'
  is the real one; drafts also live there).
- crm_* tables hold partner/vendor/referral/student CRM records; ce_* tables hold continuing education.

Doctor / provider production — get this right, it is the most commonly asked question:
- Production is credited to the CASE OWNER, falling back to the staff member when the line has
  no case owner. Roughly 2,000 lines a month have a NULL case_owner, so grouping on case_owner
  alone silently drops ~$180k a month and changes who ranks first. When you must aggregate
  ezyvet_invoice_line yourself, always group by
  coalesce(nullif(case_owner,''), nullif(staff_member,'')) — never by case_owner or staff_member alone.
- Canonical sources, in order of preference:
  * doctor revenue for a MONTH -> report_case_owner_by_month (year, case_owner, month date, revenue)
  * doctor revenue/appointments for a YEAR -> report_by_case_owner (staff_member column holds the provider, is_vet flags doctors)
  * doctor by location -> report_staff_by_location; by department -> report_dvm_by_dept
  * doctor by product/service -> report_case_owner_product(_group)
  report_by_staff is the SALESPERSON view (who rang the line up), not production — only use it
  for support-staff questions.`;

const SQL_RULES = `Rules for the SQL:
- PostgreSQL. The search_path is already the app schema, so reference tables unqualified.
- Exactly ONE statement, starting with SELECT or WITH. No semicolon. Never write INSERT,
  UPDATE, DELETE, CREATE, ALTER, DROP, GRANT, REFRESH, COPY or CALL — the query is rejected.
- Return a small result: aggregate where possible and add ORDER BY + LIMIT (max ${ROW_LIMIT}) for lists.
- Give every column a short, human-readable alias (e.g. "avg_age_years", "client_count").
- Round money to 2 decimals and averages to 1 decimal.
- Match names/text case-insensitively with ILIKE, and match category values with
  ILIKE '%fragment%' rather than = unless the exact stored value is listed under
  "Common column values" below. Guessed literals are the #1 cause of a wrong answer:
  a filter that matches nothing returns an empty/NULL result that reads like "no data".
- Prefer the widest correct scope. Do not add filters the user did not ask for (no date
  window, no location, no is_active) unless the question implies one.
- Ignore NULLs that would skew an average (e.g. patients with no date_of_birth), and report
  the count of rows behind an aggregate (e.g. add a "patients" count alongside "avg_age_years")
  so the answer can be sanity-checked.
- Exclude the NULL/blank grouping key from "who is top" rankings, but never let unattributed
  rows change the attribution rule — apply the coalesce described above instead.
- Only use tables and columns that appear in the schema listing below.`;

function planSystemPrompt(schema: string, values: string, today: string): string {
  return `You are the Smart Report analyst for Green Dog Ops, a veterinary practice management app.
You answer questions by writing ONE read-only PostgreSQL query against the app's database.
You can see the ENTIRE database below — every table, view and materialised view the app has,
with its row count. Use whichever one answers the question, not just the obvious tables.

Today is ${today}.

${DOMAIN_NOTES}

${SQL_RULES}

Reply with a single JSON object, no prose, using exactly these keys:
{"sql": "<the SELECT statement, or null>", "note": "<one short sentence on any assumption you made, or null>", "answer": "<only when no query is needed or the question cannot be answered from this schema, otherwise null>"}

Database schema (name [kind, approx rows](column type, ...)):
${schema}
${
  values
    ? `\nCommon column values (the EXACT text stored in these columns — use them verbatim in filters):\n${values}`
    : ""
}`;
}

const ANSWER_SYSTEM_PROMPT = `You are the Smart Report analyst for Green Dog Ops, a veterinary practice.
You are given a user's question, the SQL that was run, and the rows it returned.
Answer the question directly in plain English, leading with the number or fact asked for.
Use the data only — never invent figures. Format money as $1,234.56 and round sensibly.
If several rows came back, summarise the highlights in a short markdown list (max 8 bullets);
the full table is shown to the user separately, so do not repeat every row.
If the result is empty or every value is NULL, say the query matched nothing and name the most
likely reason (a filter that doesn't match the stored wording, or that column not being filled in
by ezyVet). Do not state a figure of zero as if it were a finding.
Keep it under 120 words.
Reply with plain text, no JSON and no code fences.`;

function parsePlan(raw: string): { sql: string | null; note: string | null; answer: string | null } {
  const text = unwrapJson(raw);
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const str = (k: string): string | null => {
      const v = obj[k];
      if (typeof v !== "string") return null;
      const s = v.trim();
      return s && s.toLowerCase() !== "null" ? s : null;
    };
    return { sql: str("sql"), note: str("note"), answer: str("answer") };
  } catch {
    // Some models answer with a bare SQL statement instead of JSON.
    if (/^\s*(with|select)\s/i.test(text)) return { sql: text.trim(), note: null, answer: null };
    // A reply cut off by the token limit is still usable if the query survived.
    const salvaged = salvageSql(text);
    if (salvaged) return { sql: salvaged, note: null, answer: null };
    return { sql: null, note: null, answer: text.trim() || null };
  }
}

/** Pull the "sql" value out of a JSON reply that never finished (or lost its closing brace). */
function salvageSql(text: string): string | null {
  const start = /"sql"\s*:\s*"/.exec(text);
  if (!start) return null;
  let out = "";
  for (let i = start.index + start[0].length; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      const next = text[i + 1];
      out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "" : (next ?? "");
      i++;
      continue;
    }
    if (ch === '"') break;
    out += ch;
  }
  out = out.trim();
  return /^(with|select)\s/i.test(out) ? out : null;
}

function columnsOf(rows: SmartRow[]): string[] {
  const seen: string[] = [];
  for (const row of rows.slice(0, 25)) {
    for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

/** No rows at all, or a single aggregate row where everything came back NULL. */
function isEmptyResult(rows: SmartRow[]): boolean {
  if (!rows.length) return true;
  if (rows.length > 1) return false;
  return Object.values(rows[0]).every((v) => v === null || v === undefined);
}

function historyBlock(history: SmartTurn[]): string {
  const recent = history.slice(-6);
  if (!recent.length) return "";
  return `Earlier in this conversation:\n${recent
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content.slice(0, 400)}`)
    .join("\n")}\n\n`;
}

/**
 * Answer one question. `admin` must be a service-role client — the smart_query
 * RPC is not callable by the browser, and the caller is expected to have already
 * verified the user has admin access to the reporting module.
 */
export async function askSmartReport(
  admin: AdminClient,
  question: string,
  history: SmartTurn[] = [],
): Promise<SmartResult> {
  const empty: Omit<SmartResult, "answer" | "ok"> = {
    sql: null,
    rows: [],
    columns: [],
    rowCount: 0,
    truncated: false,
    provider: null,
    attempts: [],
  };

  const q = question.trim();
  if (!q) return { ok: false, answer: "Ask a question about your data to get started.", ...empty };
  if (!hasLlmProvider()) {
    return {
      ok: false,
      answer:
        "Smart Report needs an AI provider. Ask an administrator to set GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY.",
      ...empty,
    };
  }

  const { schema, values } = await getSchemaCatalog(admin);
  const today = new Date().toISOString().slice(0, 10);
  const system = planSystemPrompt(schema, values, today);

  const attempts: SmartAttempt[] = [];
  let provider: string | null = null;
  let sql: string | null = null;
  let rows: SmartRow[] = [];
  let note: string | null = null;
  let emptyRetries = 0;
  // The best query that actually ran, kept so a genuinely empty dataset still
  // gets an answer instead of "I couldn't build a query".
  let fallback: { sql: string; rows: SmartRow[]; note: string | null } | null = null;

  for (let attempt = 0; attempt < MAX_SQL_ATTEMPTS; attempt++) {
    const retryBlock = attempts.length
      ? `\n\nYour previous attempt(s) did not work. Fix the query.\n${attempts
          .map((a) => `SQL: ${a.sql}\nProblem: ${a.error}`)
          .join("\n\n")}`
      : "";

    const plan = await callTextLLM(
      system,
      `${historyBlock(history)}Question: ${q}${retryBlock}`,
      { json: true, maxTokens: 4000, thinkingBudget: 1024 },
    );
    if (!plan.ok) return { ok: false, answer: plan.error, ...empty, attempts };
    provider = plan.provider;

    const parsed = parsePlan(plan.content);
    if (!parsed.sql) {
      if (parsed.answer && attempt === MAX_SQL_ATTEMPTS - 1) {
        return { ok: false, answer: parsed.answer, ...empty, provider, attempts };
      }
      attempts.push({
        sql: parsed.answer?.slice(0, 200) ?? "(no query)",
        error: "No SQL came back. Reply with the JSON object and put the SELECT in the \"sql\" key.",
      });
      continue;
    }

    sql = parsed.sql;
    note = parsed.note;
    const { data, error } = await admin.rpc("smart_query", { p_sql: sql, p_limit: ROW_LIMIT });
    if (error) {
      attempts.push({ sql, error: error.message });
      sql = null;
      continue;
    }

    rows = (data ?? []) as SmartRow[];
    // A query that runs but finds nothing is usually a filter that does not match
    // the stored text (species = 'Dog'), not a genuinely empty dataset. Hand that
    // back to the model once so it can widen the query.
    if (isEmptyResult(rows) && emptyRetries < MAX_EMPTY_RETRIES) {
      emptyRetries += 1;
      fallback ??= { sql, rows, note };
      attempts.push({
        sql,
        error:
          "The query ran but returned no data (no rows, or every value was NULL). Check the filters against the \"Common column values\" list and try again with looser matching (ILIKE '%fragment%', no date window). If the column really is empty, answer with the same query.",
      });
      rows = [];
      sql = null;
      continue;
    }
    break;
  }

  if (!sql && fallback) {
    ({ sql, rows, note } = fallback);
  }

  if (!sql) {
    return {
      ok: false,
      answer: `I wasn't able to build a working query for that. Last database error: ${
        attempts.at(-1)?.error ?? "unknown"
      }`,
      ...empty,
      provider,
      attempts,
    };
  }

  const preview = JSON.stringify(rows.slice(0, ROWS_IN_PROMPT)).slice(0, 24000);
  const summary = await callTextLLM(
    ANSWER_SYSTEM_PROMPT,
    `Question: ${q}\n\nSQL run:\n${sql}\n\nRows returned (${rows.length}${
      rows.length > ROWS_IN_PROMPT ? `, first ${ROWS_IN_PROMPT} shown` : ""
    }):\n${preview}${note ? `\n\nAssumption made when writing the query: ${note}` : ""}`,
    { maxTokens: 700, temperature: 0.2 },
  );

  return {
    ok: true,
    answer: summary.ok
      ? summary.content.trim()
      : rows.length
        ? "Here are the results."
        : "That query returned no rows.",
    sql,
    rows,
    columns: columnsOf(rows),
    rowCount: rows.length,
    truncated: rows.length >= ROW_LIMIT,
    provider: summary.ok ? summary.provider : provider,
    attempts,
  };
}
