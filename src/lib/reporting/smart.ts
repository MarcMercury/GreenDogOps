import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { callTextLLM, hasLlmProvider, unwrapJson } from "@/lib/ai/llm";
import { REPORT_DOCS } from "./report-docs";
import { REPORT_SPECS } from "./report-specs";
import {
  blockedIdentifier,
  scopeNotice,
  scrubRows,
  type SmartScope,
} from "./smart-scope";

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

/** Rows requested from the database for one question. null = no cap. */
const ROW_LIMIT: number | null = null;
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

type CatalogFunction = {
  name: string;
  args: string;
  returns: string;
  comment: string | null;
};

type PolicyPassage = {
  title: string;
  category: string;
  source_url: string | null;
  content: string;
};

/** Passages to retrieve from the policy library for one question. */
const PASSAGE_LIMIT = 6;
const PASSAGE_CHARS = 1200;

/** Verified question/SQL pairs to show the model as worked examples. */
const EXAMPLE_LIMIT = 3;

type SmartExample = { question: string; sql: string };

/**
 * The closest questions an admin has confirmed were answered correctly, with
 * the SQL that answered them. This is how the report improves with use: a
 * verified answer becomes guidance for the next similar question.
 *
 * Examples are filtered through the caller's scope — a verified query that
 * touches a column this user may not read would otherwise leak the column name
 * and tempt a query the guard then rejects.
 */
async function getExamples(
  admin: AdminClient,
  question: string,
  scope: SmartScope,
): Promise<SmartExample[]> {
  const { data, error } = await admin.rpc("smart_examples", {
    p_question: question,
    p_limit: EXAMPLE_LIMIT,
  });
  // Examples are a bonus — never fail the report over them.
  if (error) return [];
  return ((data ?? []) as SmartExample[]).filter(
    (e) => e.sql && !blockedIdentifier(e.sql, scope),
  );
}

function exampleBlock(examples: SmartExample[]): string {
  if (!examples.length) return "";
  return `\nWorked examples — these questions were answered with this SQL and a human confirmed the
answer was right. Follow the same tables, joins and definitions when the question is similar;
adapt the filters rather than inventing a different approach:\n${examples
    .map((e, i) => `[${i + 1}] ${e.question}\n${e.sql}`)
    .join("\n\n")}\n`;
}

/**
 * Full-text search over the TEXT of the policy/protocol documents.
 *
 * These live in resource_document_chunk rather than being queried by the
 * model's own SQL on purpose: smart_query() rejects a statement containing
 * words like "create", and a policy question ("how do I create a hazard
 * report?") would put that word inside the search literal.
 */
async function getPolicyPassages(
  admin: AdminClient,
  question: string,
): Promise<PolicyPassage[]> {
  const { data, error } = await admin.rpc("search_resource_content", {
    p_query: question,
    p_limit: PASSAGE_LIMIT,
  });
  // Documents are a bonus source — never fail the report over them.
  if (error) return [];
  return (data ?? []) as PolicyPassage[];
}

function passageBlock(passages: PolicyPassage[]): string {
  if (!passages.length) return "";
  const body = passages
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title}${p.source_url ? ` (${p.source_url})` : ""}\n${p.content.slice(0, PASSAGE_CHARS)}`,
    )
    .join("\n\n");
  return `\nPolicy & protocol excerpts (the company's own HR/safety documents, matched to this question):\n${body}\n`;
}

/** Markdown "Sources" footer so a policy answer is always traceable to a document. */
function sourceList(passages: PolicyPassage[]): string {
  const seen = new Map<string, string | null>();
  for (const p of passages) if (!seen.has(p.title)) seen.set(p.title, p.source_url);
  const lines = [...seen]
    .slice(0, 4)
    .map(([title, url]) => (url ? `- [${title}](${url})` : `- ${title}`));
  return lines.length ? `\n\n**Sources**\n${lines.join("\n")}` : "";
}

let catalogCache: {
  tables: CatalogTable[];
  hints: ValueHint[];
  functions: CatalogFunction[];
  at: number;
} | null = null;

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
 *
 * The raw catalog is cached and then rendered PER SCOPE: anything the caller
 * may not read is left out entirely, so the model does not waste attempts
 * writing queries that the guard in askSmartReport would reject.
 */
async function getSchemaCatalog(
  admin: AdminClient,
  scope: SmartScope,
): Promise<{ schema: string; values: string; functions: string }> {
  if (!catalogCache || Date.now() - catalogCache.at >= SCHEMA_TTL_MS) {
    const [{ data, error }, hints, fns] = await Promise.all([
      admin.rpc("smart_schema"),
      admin.rpc("smart_value_hints"),
      admin.rpc("smart_functions"),
    ]);
    if (error) throw new Error(`Could not read the database schema: ${error.message}`);
    catalogCache = {
      tables: (data ?? []) as CatalogTable[],
      // A failure here must not break the report — the vocabulary is a bonus.
      hints: ((hints.data ?? []) as ValueHint[]).filter((h) => h.values?.length),
      functions: (fns.data ?? []) as CatalogFunction[],
      at: Date.now(),
    };
  }

  const blockedTables = new Set(scope.blockedTables);
  const blockedColumns = new Set(scope.blockedColumns);

  const schema = catalogCache.tables
    .filter((t) => !blockedTables.has(t.name.toLowerCase()))
    .map(
      (t) =>
        `${t.name} [${t.kind}${rowLabel(t.rows)}](${t.columns
          .filter((c) => !blockedColumns.has(c.name.toLowerCase()))
          .map((c) => `${c.name} ${c.type}`)
          .join(", ")})`,
    )
    .join("\n");

  const values = catalogCache.hints
    .filter(
      (h) =>
        !blockedTables.has(h.table.toLowerCase()) &&
        !blockedColumns.has(h.column.toLowerCase()),
    )
    .map((h) => `${h.table}.${h.column} = ${h.values.join(" | ")}`)
    .join("\n");

  const functions = catalogCache.functions
    .map(
      (f) =>
        `${f.name}(${f.args}) -> ${f.returns.replace(/^TABLE/, "")}${
          f.comment ? `\n    ${f.comment}` : ""
        }`,
    )
    .join("\n");

  return { schema, values, functions };
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
  ezyvet_created_at is when the client record was created = when they became a client.

NEW CLIENTS and per-hospital client questions — read this before writing the query:
- A NEW CLIENT is a contact whose ezyvet_created_at falls in the period (~450/month company-wide).
  report_clients_by_month is the canonical company-wide roll-up and is what the Reporting page shows.
- ezyvet_contact.division is NOT the hospital. It only ever contains 'GDD & MPMV' or
  'Green Dog - Sherman Oaks' — there is NO Venice or Van Nuys value. Filtering contacts by a
  Venice/Van Nuys division returns ZERO rows and reads like "we signed up no one", which is wrong.
  (The four-hospital division labels exist on ezyvet_animal and ezyvet_product_price, not here.)
- ezyvet_contact.ezyvet_created_by / staff_member are ezyVet SECURITY ROLES, not people and not
  locations: 'RCSRs' (the remote CSR team, who create most records), 'Vetstoria' (online booking),
  'Emily AI', 'VE Front Office', 'VALLEY Front Office', 'SO Front Office'. Only a small minority are
  location-named, so counting one of them massively undercounts a hospital. Never attribute a
  client to a hospital this way.
- The ONLY reliable hospital attribution for a client is ezyvet_invoice_line.location_key
  ('sherman_oaks', 'van_nuys', 'venice', 'other'). Use report_new_clients_by_location_month
  (month, location_key, location_label, new_clients, new_customers) for "new clients at <hospital>"
  — it pins each new contact to the location of their FIRST billed line, and location_key
  'no_visit_yet' holds clients created but not yet billed anywhere (about a quarter of them), so
  mention that bucket rather than silently dropping it.
- ezyvet_invoice_line only goes back to 2025-01-02. Never derive "who was new" from a first
  invoice line for 2025 or earlier — every pre-existing client looks new at the start of the data.
- ezyvet_product = the PRODUCT/SERVICE CATALOG (~4k rows), refreshed nightly from ezyVet. This
  is what the practice SELLS: product_name, product_code, product_group (the financial product
  group, e.g. 'Medications - Rx', '*Services', 'Consumables, Food, and Supplements'),
  product_type ('Standard','Diagnostic','Medication','Procedure','Vaccination','Service Fee'),
  clinical_type, requires_prescription, is_rabies_vax, supplier, minimum_inventory and
  last_invoiced_date (when it last sold). The export only contains ACTIVE products.
- ezyvet_product_price = PRICES, one row per product PER HOSPITAL (product_code + division,
  ~8k rows): cost, sell_price_excl, sell_price_incl, markup. Prices are set per division, so
  a product has several rows — never sum prices across divisions, filter or group by division.
  division values match ezyvet_animal.division ('Green Dog - Sherman Oaks', 'Green Dog - Van Nuys',
  'Green Dog - Venice (BU)', 'GDD & MPMV' = the shared parent list).
- For any "what do we charge / what does X cost / margin" question use report_product_price_list
  (product + price joined, plus margin_dollars); report_products_by_group and
  report_product_summary are the catalog roll-ups. Join products to sales with
  ezyvet_invoice_line.product_code = ezyvet_product.product_code — the catalog holds the CURRENT
  price, the invoice line holds what was actually billed.
- Product names are inconsistent free text: 'X Ray', 'Xray' and 'X-Ray' all occur, punctuation is
  erratic ('Dental X Ray- FULL MOUTH') and clinic-specific versions are prefixed ('SO Dental X Ray-
  FULL MOUTH' for Sherman Oaks). NEVER match a multi-word product with one ILIKE '%dental x-ray%'.
  Instead AND one ILIKE '%word%' per significant word, dropping hyphens and stop words
  (e.g. name ILIKE '%dental%' AND name ILIKE '%x%ray%'), and return the matches so the reader
  can pick the right one.
- ezyvet_appointment (matview) = one row per client visit day that has ALREADY BEEN BILLED:
  client_contact_code, service_date, location_key, revenue, pet_count. It is derived from
  ezyvet_invoice_line, so it ONLY covers PAST, RENDERED visits and has NO rows for today or any
  future date (those appointments are not invoiced yet). Use it for historical visit counts and
  revenue-per-visit, counting DISTINCT visits here, never invoice lines. For "how many
  appointments today / tomorrow / this week / scheduled / on the board / booked / upcoming" you
  MUST use the agenda snapshot tables below — this matview will wrongly report zero.
- SCHEDULED / BOOKED appointments (the live ezyVet appointment book = the "clinic board") live in
  the agenda snapshot tables, refreshed several times a day, and DO cover today and future dates:
  * ezyvet_agenda_snapshot = aggregate booked counts, one row per
    (location_id, appt_date, department_id, snapshot_date) with appt_count. This is the source for
    "how many appointments are booked on <day> at <location>".
  * ezyvet_agenda_appt_snapshot = one row per individual booked appointment (client_name,
    patient_name, resource, appt_time, appt_type, status) for per-appointment detail.
  These tables key location by location_id (uuid) -> greendogops.location (name 'Venice',
  'Van Nuys', 'Sherman Oaks', ...), NOT by the location_key text on the invoice tables, so JOIN
  greendogops.location on location_id and match the hospital by l.name ILIKE '%venice%'.
  snapshot_date is the day the pull was taken, appt_date is the day of the appointment; the same
  appt_date appears in MANY snapshots, so ALWAYS take the latest snapshot per cell — e.g.
  distinct on (location_id, appt_date, department_id) ... order by ..., snapshot_date desc — then
  sum(appt_count), or counts multiply by the number of pulls. The canonical booked-vs-rendered
  numbers come from the function appointment_review(p_start date, p_end date) (returns
  location_name, department_name, appt_date, expected_count = booked, rendered_count = actually
  seen); query it directly, e.g. select location_name, sum(expected_count) as booked from
  appointment_review(current_date, current_date) group by location_name.
- An appointment is NOT an invoice line — never count invoice lines to answer "how many appointments".

Wellness plan ("Green Dog Plus" / "GDD+") membership — counting this wrong is easy:
- ezyvet_wellness_plan_use (and report_wellness_plan_current, which pins the latest snapshot) is
  one row per PET per PLAN BENEFIT — ~21,500 rows for ~910 members. NEVER count rows, and never
  count distinct unique_id, to answer "how many members": that returns a benefit count in the
  thousands and is wrong by ~20x.
- A MEMBER / CLIENT on the plan = count(distinct customer_code). An enrolled PET = count(distinct
  pet_code). There are more pets than members (some clients enrol several pets), so always say
  which one you counted.
- There is NO status/active column: every row in the latest snapshot IS a current active member.
  "Active members", "current members" and "members" all mean the same count(distinct customer_code)
  over report_wellness_plan_current. Do NOT approximate "active" with available > 0 (that is
  "members with unused benefits left" and undercounts) or used > 0 ("members who have redeemed
  something") — those are different questions, so answer them only if that is what was asked.
- The plan column has exactly two values and they are PRICE TIERS, not different products:
  'Green Dog Plus' is the ORIGINAL/OLD price and 'Green Dog Plus #2' is the NEWER/CURRENT price.
  A handful of clients hold BOTH, so the per-plan member counts add up to MORE than the distinct
  total — when splitting members old vs new, classify each customer_code once (e.g. group by
  customer_code with bool_or(plan = ...)) instead of grouping by plan, and say how the overlap
  was treated.
- Membership TENURE ("on the plan more than a year") must be measured per member, not per benefit
  row: take min(term_start_date) per customer_code, then compare that to
  current_date - interval '1 year'. term_start_date repeats on every one of that pet's benefit rows.
- EXPIRY / RENEWAL: there is no expiry, term_end or renewal column — do NOT answer "we can't tell".
  A plan term runs ONE YEAR from term_start_date, so a pet's plan expires (renews) on
  term_start_date + interval '1 year'. A pet can carry benefit rows from more than one term
  (about 1 in 5 do), so take the CURRENT term first — max(term_start_date) per pet_code — and
  date the renewal off that:
    with per_pet as (select pet_code, max(pet_name) as pet_name, max(customer_name) as owner_name,
                            max(location_key) as location_key, max(term_start_date) as term_start
                       from report_wellness_plan_current group by pet_code)
    select pet_name, owner_name, location_key, term_start,
           (term_start + interval '1 year')::date as renews_on
      from per_pet
     where (term_start + interval '1 year')::date >= date_trunc('month', current_date)::date
       and (term_start + interval '1 year')::date <  (date_trunc('month', current_date) + interval '1 month')::date
     order by renews_on
  "Expiring/renewing this month" is that anniversary inside the current calendar month; a renewal
  date already in the PAST means the plan has lapsed. Expiry is a PER-PET question (the pet holds
  the term), so list pets with their owner, not distinct customers.
- Keep these definitions STABLE across a conversation: if a follow-up question refines an earlier
  one ("of those members, how many..."), reuse the exact same population and filters as the
  previous answer so the totals still reconcile, and if you must change the definition, say so.
REPORTING PAGE PARITY — the /reporting page is the official number. If a question asks for
anything that page shows, query the SAME report_* view it uses, with the same year filter, and
do NOT recompute it from ezyvet_invoice_line. A hand-rolled sum will disagree and the reader
will treat one of them as broken.
- Every revenue/appointment roll-up is built on the ezyvet_appointment matview, which is one row
  per (client_contact_code, line_date, location_key) from ezyvet_invoice_line, keeping only
  client-days that contain at least one APPOINTMENT line. A line is NOT an appointment line when
  the product name contains 'deposit' or 'refund', or the product_group is one of: Retail;
  Consumables, Food, and Supplements; Supplies; Parasite Control; Medications - Rx; Controlled
  Substances - Rx; Green Dog Pet Plus Wellness Plan; Follow Up; Cremation Services; Service Fee;
  *Discount/Credit/Deposit. revenue = sum(total_incl) of ALL lines on a qualifying day (the retail
  items bought during that visit count), but a retail- or pharmacy-only day is dropped entirely.
  That is why a raw sum over ezyvet_invoice_line is always HIGHER than the Reporting page
  (July 2026: report_monthly $1,112,238.62 vs raw lines $1,174,141.65).
- Which view backs which part of the page:
  * headline totals -> report_overview (total_appointments, total_lines, total_revenue, unique_clients)
  * monthly bars -> report_monthly; per clinic -> report_by_location; clinic x month -> report_location_monthly
  * species mix -> report_by_species (species_group of the visit's biggest line)
  * Products/Services -> report_top_product_group, report_top_product, report_product_by_location
  * Doctors/Staff -> report_by_case_owner (production), report_by_staff (salesperson),
    report_staff_by_location, report_case_owner_by_month
  * DVM by Dept -> report_dvm_by_dept (joins the PUBLISHED schedule and splits a doctor's day
    across the departments they were rostered in — it is NOT derivable from invoices alone)
  * Clients -> report_client_summary, report_clients_by_month, report_clients_by_recency(_location)
  * Patients -> report_patients_by_species, report_species_by_recency
- TWO DIFFERENT BASES — never add them together or try to reconcile them, and always say which
  one you used:
  * APPOINTMENT base (retail-only days dropped): report_overview, report_monthly,
    report_by_location, report_location_monthly, report_by_species.
  * RAW INVOICE LINE base (every line, including retail and Rx): report_by_case_owner,
    report_by_staff, report_staff_by_location, report_case_owner_by_month, report_top_product(_group),
    report_product_by_location.
  So the doctors' revenue will not sum to the monthly revenue. That is expected, not an error.
- The "appointments" count also differs by view: report_overview/monthly/by_location count a
  distinct (client, day, LOCATION); report_by_case_owner/report_by_staff count a distinct
  (client, day) with no location. Use the view that matches the question rather than mixing them.
- year on every report_* view comes from the line/service date, and the page defaults to the
  LATEST year that has data (report_years), which may not be the current calendar year. For
  "this year" use the current year; if that year has no rows, say so rather than returning zero.
- The client and patient views are a CURRENT SNAPSHOT and are not year-scoped at all.
- report_* views/matviews are pre-aggregated roll-ups that encode the practice's official
  definitions. Their "month" column is a DATE (first of the month), not an integer,
  e.g. month = date '2026-06-01'.
- person = staff/roster and recruiting candidates; person.status tells them apart
  ('employee', 'contractor', 'former', 'applicant', 'prospect') — always filter it, the table is
  mostly applicants. person_employment holds hire_date, pay, PTO, adp_job_title (the real job
  title; offer_title is the offer letter) and location_id -> sched_location.
  Job titles are free text, so identify DOCTORS by their schedule role instead:
  sched_role_member -> sched_role where name ilike '%dvm%' (15 people), and technicians/CSRs the
  same way. sched_* tables hold the published staff schedule (sched_assignment.status='published'
  is the real one; drafts also live there).
- crm_* tables hold partner/vendor/referral/student CRM records; ce_* tables hold continuing education.

Pay / salary / compensation (person_employment) — every one of these has produced a wrong answer:
- ALWAYS join person and filter the status. "Our employees" / "our highest paid employee" means
  p.status = 'employee' (add 'contractor' only when the question is about contractors or about
  everyone we pay). 'former' is separated staff and 'applicant'/'prospect' are candidates who were
  never on payroll — leaving them in returns an ex-employee as the current top earner.
- annual_wages is the normalised ANNUAL figure and is the ONLY column to rank, compare or average
  pay on. biweekly_wage * 26 should equal it.
- current_rate is AMBIGUOUS: it holds an HOURLY rate for hourly staff (e.g. 23.50) and an ANNUAL
  salary for salaried staff (e.g. 250000) in the same column. Never rank on it, never compare it
  across people, and never multiply it by 2080 to annualise.
- pay_type is NULL on every row today. Never filter on it and never branch on it.
- Roughly 1 in 5 current employees has NO salary on file (annual_wages is NULL). A pay ranking
  MUST say WHERE annual_wages IS NOT NULL and ORDER BY annual_wages DESC NULLS LAST, and should
  report how many people were excluded for having no figure recorded.
- The roster is hand-maintained and a handful of rows have data-entry typos (a biweekly amount
  typed into the annual column, or an annual amount typed into the biweekly column). When ranking
  or averaging pay, keep only plausible figures — annual_wages between 20000 and 400000 — and note
  that implausible rows were skipped. A technician "salary" in the millions is a typo, not an answer.

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

/**
 * The 26 spec-driven ezyVet report tables (payments, receivables, daily close,
 * appointment timings, clinical compliance, inventory). Built from REPORT_DOCS
 * so the note the model reads is the same text stored as the table comment.
 */
const EXTRA_REPORT_NOTES = `
Daily ezyVet report tables — these cover ground the invoice/patient tables cannot.
Each carries snapshot_date (the day of the pull) plus period_start/period_end (the
window requested). SNAPSHOT tables repeat their whole contents every day, so a query
that does not pin one snapshot_date multiplies every total by the number of days
ingested — prefer the matching report_* view, which already pins the latest pull:
${Object.entries(REPORT_DOCS)
  .filter(([key]) => REPORT_SPECS[key])
  .map(([key, doc]) => `- ${REPORT_SPECS[key].table} (ezyVet "${doc.report}"): ${doc.comment}`)
  .join("\n")}

Views over those tables: report_daily_collections (payments by day/location/method),
report_ar_aging_current + report_ar_aging_trend, report_appointment_flow (wait and
consult minutes by day/location), report_unbilled_consults_current,
report_estimate_conversion, report_clinical_note_backlog, report_soc_overdue_current,
report_inventory_on_hand, report_inventory_value_trend, report_reorder_list,
report_wellness_plan_current.

Money rule: ezyvet_invoice_line is what we BILLED; ezyvet_payment is what we
COLLECTED; ezyvet_aged_receivable is what is still OWED. They will not agree and
should not be added together. Margin/gross profit exists only in ezyvet_staff_sale
and ezyvet_customer_invoice_stat.`;

const SQL_RULES = `Rules for the SQL:
- PostgreSQL. The search_path is already the app schema, so reference tables unqualified.
- Exactly ONE statement, starting with SELECT or WITH. No semicolon. Never write INSERT,
  UPDATE, DELETE, CREATE, ALTER, DROP, GRANT, REFRESH, COPY or CALL — the query is rejected.
- Aggregate where possible and always add ORDER BY. Do NOT add a LIMIT unless the user
  asked for a top-N ("top 10", "first 5") — a full list must come back complete, however
  many rows that is. The result set is not capped.
- Give every column a short, human-readable alias (e.g. "avg_age_years", "client_count").
- Many tables hold one row per X per Y (per benefit, per line, per snapshot, per overdue item).
  Before counting, decide WHICH ENTITY the question is about and count(distinct <that key>) —
  a raw count(*) on those tables answers a different question and is usually wrong by an order
  of magnitude. Name the entity in the alias ("member_count", not "count").
- If the question is a FOLLOW-UP to an earlier turn ("of those, how many...", "how many of them"),
  reuse the SAME population, table and filters as the previous query so the numbers reconcile
  with the answer already given. Never silently switch the counted entity between turns.
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
- In PostgreSQL, ORDER BY <col> DESC puts NULLs FIRST. Every "highest / top / most / largest"
  question MUST use ORDER BY <measure> DESC NULLS LAST, and normally also WHERE <measure> IS NOT
  NULL — otherwise the "winner" is a row with no value at all. Same for ASC and "lowest".
- Exclude the NULL/blank grouping key from "who is top" rankings, but never let unattributed
  rows change the attribution rule — apply the coalesce described above instead.
- Sanity-check a single-row "who is the top X" result before returning it: if the winning value is
  orders of magnitude away from the rest of the column, it is bad data, not the answer.
- A count of ZERO is almost never the right answer at a busy three-hospital practice. If a query
  would report 0 (or 0 for every period), assume a filter literal is wrong — especially a division,
  location or status value you guessed — and rewrite it with a looser filter or a different column
  before answering.
- Only use tables and columns that appear in the schema listing below.`;

function planSystemPrompt(
  schema: string,
  values: string,
  functions: string,
  today: string,
  passages: string,
  examples: string,
  restrictions: string,
): string {
  return `You are the Smart Report analyst for Green Dog Ops, a veterinary practice management app.
You answer questions by writing ONE read-only PostgreSQL query against the app's database.
You can see the ENTIRE database below — every table, view and materialised view the app has,
with its row count. Use whichever one answers the question, not just the obvious tables.

Today is ${today}.

${DOMAIN_NOTES}

${EXTRA_REPORT_NOTES}

${SQL_RULES}
${restrictions}
${examples}
${
  passages
    ? `\nSome questions are about company POLICY or PROCEDURE rather than data. When the excerpts below
answer the question, set "sql" to null and put the answer in "answer", quoting the document by name.
Never guess at policy: if the excerpts do not cover it, say so rather than inventing a rule.
${passages}`
    : ""
}
Reply with a single JSON object, no prose, using exactly these keys:
{"sql": "<the SELECT statement, or null>", "note": "<one short sentence on any assumption you made, or null>", "answer": "<only when no query is needed or the question cannot be answered from this schema, otherwise null>"}

Database schema (name [kind, approx rows](column type, ...)):
${schema}
${
  functions
    ? `\nQueryable functions — call these in the FROM clause like a table, e.g.
select location_name, sum(expected_count) from appointment_review(current_date, current_date)
group by location_name. Each one already encodes a rule that is easy to get wrong by hand,
so prefer it over rebuilding the logic:\n${functions}\n`
    : ""
}${
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

/**
 * No rows at all, or a single aggregate row that carries no information — every
 * value NULL, or every value zero. `count(*) = 0` is almost always a filter that
 * matched nothing, not a real answer, so it gets the same retry as no rows.
 */
function isEmptyResult(rows: SmartRow[]): boolean {
  if (!rows.length) return true;
  if (rows.length > 1) return false;
  return Object.values(rows[0]).every(
    (v) => v === null || v === undefined || v === 0 || v === "0",
  );
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
 * RPC is not callable by the browser. `scope` is what the ASKING USER is
 * allowed to see: smart_query bypasses RLS, so it is the only thing keeping
 * salaries and confidential employee records out of the answer.
 */
export async function askSmartReport(
  admin: AdminClient,
  question: string,
  scope: SmartScope,
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

  const [{ schema, values, functions }, passages, examples] = await Promise.all([
    getSchemaCatalog(admin, scope),
    getPolicyPassages(admin, q),
    getExamples(admin, q, scope),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const system = planSystemPrompt(
    schema,
    values,
    functions,
    today,
    passageBlock(passages),
    exampleBlock(examples),
    scopeNotice(scope),
  );

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
      // A policy question is answered from the retrieved documents, not SQL.
      if (parsed.answer && passages.length) {
        return {
          ok: true,
          answer: `${parsed.answer}${sourceList(passages)}`,
          ...empty,
          provider,
          attempts,
        };
      }
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

    // Hard gate. The prompt already hides these, but the model's SQL is never
    // trusted: smart_query runs as service_role and would happily return them.
    const blocked = blockedIdentifier(sql, scope);
    if (blocked) {
      attempts.push({
        sql,
        error: `"${blocked}" is not available to this user. Answer without it, or explain that the data is restricted.`,
      });
      sql = null;
      continue;
    }

    const { data, error } = await admin.rpc("smart_query", { p_sql: sql, p_limit: ROW_LIMIT });
    if (error) {
      attempts.push({ sql, error: error.message });
      sql = null;
      continue;
    }

    rows = scrubRows((data ?? []) as SmartRow[], scope);
    // A query that runs but finds nothing is usually a filter that does not match
    // the stored text (species = 'Dog'), not a genuinely empty dataset. Hand that
    // back to the model once so it can widen the query.
    if (isEmptyResult(rows) && emptyRetries < MAX_EMPTY_RETRIES) {
      emptyRetries += 1;
      fallback ??= { sql, rows, note };
      attempts.push({
        sql,
        error:
          "The query ran but returned no usable data (no rows, or every value was NULL or zero). A zero is almost always a filter that matched nothing, not a real answer — this is a busy three-hospital practice. Check every literal against the \"Common column values\" list, drop the most suspect filter, and try again with looser matching (ILIKE '%fragment%', no date window). If the column really is empty, answer with the same query.",
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
    truncated: ROW_LIMIT !== null && rows.length >= ROW_LIMIT,
    provider: summary.ok ? summary.provider : provider,
    attempts,
  };
}
