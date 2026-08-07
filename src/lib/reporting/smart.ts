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
const MAX_SQL_ATTEMPTS = 3;
const SCHEMA_TTL_MS = 10 * 60 * 1000;

type CatalogTable = {
  name: string;
  kind: string;
  columns: { name: string; type: string }[];
};

let catalogCache: { text: string; at: number } | null = null;

/** Compact `table(col type, ...)` listing of everything the query can touch. */
async function getSchemaCatalog(admin: AdminClient): Promise<string> {
  if (catalogCache && Date.now() - catalogCache.at < SCHEMA_TTL_MS) {
    return catalogCache.text;
  }
  const { data, error } = await admin.rpc("smart_schema");
  if (error) throw new Error(`Could not read the database schema: ${error.message}`);

  const tables = (data ?? []) as CatalogTable[];
  const text = tables
    .map(
      (t) =>
        `${t.name} [${t.kind}](${t.columns.map((c) => `${c.name} ${c.type}`).join(", ")})`,
    )
    .join("\n");
  catalogCache = { text, at: Date.now() };
  return text;
}

const DOMAIN_NOTES = `Domain notes (Green Dog Veterinary — three Los Angeles hospitals):
- ezyvet_invoice_line = every billed line. Revenue = sum(total_incl) (total_excl is pre-tax).
  Use line_date for "when the service happened" and invoice_date for billing date.
  location_key is one of sherman_oaks, van_nuys, venice, other. case_owner is the
  case-owning doctor; staff_member is who rang the line up. ~250k rows, so always aggregate.
- ezyvet_animal = PATIENTS (pets). date_of_birth may be null or estimated (dob_is_estimated).
  has_passed_away / is_active flag inactive patients. owner_contact_code links to
  ezyvet_contact.contact_code. Patient age in years = extract(year from age(current_date, date_of_birth)).
- ezyvet_contact = CLIENTS (pet owners) and other contacts. is_customer marks real clients,
  is_business marks companies, is_vet marks referring vets. last_name/first_name/full_name.
- ezyvet_appointment (matview) = one row per client visit day: client_contact_code,
  service_date, location_key, revenue, pet_count. Best source for appointment/visit counts.
- report_* views/matviews are pre-aggregated yearly roll-ups (report_overview, report_monthly,
  report_by_location, report_by_species, report_by_staff, report_by_case_owner, ...). They are
  fast — prefer them when the question matches their grain, otherwise query the base tables.
- person = staff/roster and recruiting candidates; person.status tells them apart
  ('employee', 'contractor', 'former', 'applicant', 'prospect'). person_employment holds
  hire_date, pay and PTO. sched_* tables hold the published staff schedule.
- crm_* tables hold partner/vendor/referral/student CRM records; ce_* tables hold continuing education.`;

const SQL_RULES = `Rules for the SQL:
- PostgreSQL. The search_path is already the app schema, so reference tables unqualified.
- Exactly ONE statement, starting with SELECT or WITH. No semicolon. Never write INSERT,
  UPDATE, DELETE, CREATE, ALTER, DROP, GRANT, REFRESH, COPY or CALL — the query is rejected.
- Return a small result: aggregate where possible and add ORDER BY + LIMIT (max ${ROW_LIMIT}) for lists.
- Give every column a short, human-readable alias (e.g. "avg_age_years", "client_count").
- Round money to 2 decimals and averages to 1 decimal.
- Match names/text case-insensitively with ILIKE.
- Ignore NULLs that would skew an average (e.g. patients with no date_of_birth).
- Only use tables and columns that appear in the schema listing below.`;

function planSystemPrompt(schema: string, today: string): string {
  return `You are the Smart Report analyst for Green Dog Ops, a veterinary practice management app.
You answer questions by writing ONE read-only PostgreSQL query against the app's database.

Today is ${today}.

${DOMAIN_NOTES}

${SQL_RULES}

Reply with a single JSON object, no prose, using exactly these keys:
{"sql": "<the SELECT statement, or null>", "note": "<one short sentence on any assumption you made, or null>", "answer": "<only when no query is needed or the question cannot be answered from this schema, otherwise null>"}

Database schema (name [kind](column type, ...)):
${schema}`;
}

const ANSWER_SYSTEM_PROMPT = `You are the Smart Report analyst for Green Dog Ops, a veterinary practice.
You are given a user's question, the SQL that was run, and the rows it returned.
Answer the question directly in plain English, leading with the number or fact asked for.
Use the data only — never invent figures. Format money as $1,234.56 and round sensibly.
If several rows came back, summarise the highlights in a short markdown list (max 8 bullets);
the full table is shown to the user separately, so do not repeat every row.
If the result is empty, say so and suggest what might be missing. Keep it under 120 words.
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
    return { sql: null, note: null, answer: text.trim() || null };
  }
}

function columnsOf(rows: SmartRow[]): string[] {
  const seen: string[] = [];
  for (const row of rows.slice(0, 25)) {
    for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
  }
  return seen;
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

  const schema = await getSchemaCatalog(admin);
  const today = new Date().toISOString().slice(0, 10);
  const system = planSystemPrompt(schema, today);

  const attempts: SmartAttempt[] = [];
  let provider: string | null = null;
  let sql: string | null = null;
  let rows: SmartRow[] = [];
  let note: string | null = null;

  for (let attempt = 0; attempt < MAX_SQL_ATTEMPTS; attempt++) {
    const retryBlock = attempts.length
      ? `\n\nYour previous attempt(s) failed. Fix the query.\n${attempts
          .map((a) => `SQL: ${a.sql}\nError: ${a.error}`)
          .join("\n\n")}`
      : "";

    const plan = await callTextLLM(
      system,
      `${historyBlock(history)}Question: ${q}${retryBlock}`,
      { json: true, maxTokens: 1200 },
    );
    if (!plan.ok) return { ok: false, answer: plan.error, ...empty, attempts };
    provider = plan.provider;

    const parsed = parsePlan(plan.content);
    if (!parsed.sql) {
      return {
        ok: false,
        answer:
          parsed.answer ??
          "I couldn't turn that into a query. Try naming the records you're interested in — patients, clients, invoices, appointments or staff.",
        ...empty,
        provider,
        attempts,
      };
    }

    sql = parsed.sql;
    note = parsed.note;
    const { data, error } = await admin.rpc("smart_query", { p_sql: sql, p_limit: ROW_LIMIT });
    if (!error) {
      rows = (data ?? []) as SmartRow[];
      break;
    }
    attempts.push({ sql, error: error.message });
    sql = null;
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
