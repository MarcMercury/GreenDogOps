#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Importer for an Indeed employer "candidates" CSV export into the ATS.
//
// Columns handled: name, email, phone, status, candidate location, relevant
// experience, education, job title, job location, date, interest level, source
// and up to 15 screening Qualification / Answer / Match triplets.
//
// Behaviour (see README block at the bottom of this comment):
//   * Rows are grouped into unique PEOPLE first (the same person often applies
//     to several postings; Indeed mints a new relay email per application, so
//     phone + name are the identity keys).
//   * Each person is matched against the existing roster/pipeline by email,
//     then phone, then normalized "first last" name.
//   * Matched EMPLOYEES / CONTRACTORS / FORMER employees are never re-added as
//     candidates. Only blank contact fields on their person row are filled and
//     an application-history note is appended.
//   * Matched APPLICANTS are updated in place: blank person fields are filled
//     and the new recruiting background columns (migration 0205) are set.
//   * Everyone else is inserted as a new person (status = applicant) plus a
//     person_recruiting row.
//
// It does NOT touch the database directly. It writes numbered SQL files that
// are applied IN ORDER with scripts/supabase-sql.sh, plus a JSON report.
//
//   scripts/supabase-sql.sh -q "select p.id, p.status, p.first_name, ..." > people.json
//   node scripts/import_indeed_candidates.mjs <candidates.csv> <people.json> <outDir>
//   for f in <outDir>/0*.sql; do scripts/supabase-sql.sh -f "$f"; done
// ---------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , CSV_PATH, PEOPLE_JSON, OUT_DIR] = process.argv;
if (!CSV_PATH || !PEOPLE_JSON || !OUT_DIR) {
  console.error(
    "Usage: import_indeed_candidates.mjs <candidates.csv> <people.json> <outDir>",
  );
  process.exit(2);
}
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 250);

// ===========================================================================
// CSV parsing (RFC 4180, handles quoted newlines)
// ===========================================================================
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// ===========================================================================
// Normalizers
// ===========================================================================

/** Professional credentials that are not part of a person's name. */
const CREDENTIALS = new Set([
  "dvm", "vmd", "dacvb", "dacvim", "rvt", "cvt", "lvt", "cvpm", "vts", "cva",
  "ma", "bs", "ba", "bsc", "ms", "msc", "mba", "mph", "phd", "dds", "np", "rn",
  "lvn", "cpht", "cpdt", "ka", "ii", "iii", "iv", "jr", "sr", "esq", "avp",
]);

const credKey = (t) => t.toLowerCase().replace(/[^a-z]/g, "");

/** Strip credential suffixes ("Jane Doe D.V.M, DACVB") down to a plain name. */
function cleanName(raw) {
  let s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  // Drop trailing comma-separated segments that are purely credentials.
  const segs = s.split(",");
  while (
    segs.length > 1 &&
    segs[segs.length - 1]
      .trim()
      .split(/\s+/)
      .every((t) => t && CREDENTIALS.has(credKey(t)))
  ) {
    segs.pop();
  }
  s = segs.join(",").trim();
  // Drop trailing credential words.
  const toks = s.split(" ");
  while (toks.length > 1 && CREDENTIALS.has(credKey(toks[toks.length - 1]))) toks.pop();
  s = toks.join(" ").replace(/[\s,.;-]+$/, "").trim();
  return s;
}

/** Title-case names that arrive ALL CAPS or all lowercase; leave others alone. */
function fixCase(name) {
  if (!name) return name;
  const letters = name.replace(/[^A-Za-z]/g, "");
  if (!letters) return name;
  const isUpper = letters === letters.toUpperCase();
  const isLower = letters === letters.toLowerCase();
  if (!isUpper && !isLower) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s'’-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
}

function splitName(full) {
  const parts = (full || "").split(" ").filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/** Identity key: "first last", credentials/punctuation removed. */
function nameKey(raw) {
  const s = cleanName(raw)
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z\s]/g, " ");
  const toks = s.split(/\s+/).filter((t) => t && t !== "dr" && !CREDENTIALS.has(t));
  if (toks.length < 2) return toks[0] || null;
  return `${toks[0]} ${toks[toks.length - 1]}`;
}

/** 10-digit NANP key, or null when the number isn't usable for matching. */
function phoneKey(raw) {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

/** House format used everywhere in the app: (###) ###-#### for NANP numbers. */
function formatPhone(raw) {
  const s = (raw || "").replace(/^'/, "").trim();
  if (!s) return null;
  const k = phoneKey(s);
  if (k) return `(${k.slice(0, 3)}) ${k.slice(3, 6)}-${k.slice(6)}`;
  const digits = s.replace(/\D/g, "");
  return digits ? s.replace(/^\+?\s*/, "+").replace(/\s+/g, " ") : null;
}

const normEmail = (s) => ((s || "").trim().toLowerCase() || null);
const clean = (s) => {
  const v = (s || "").trim();
  return v === "" ? null : v;
};

/** ALL-CAPS posting titles ("REMOTE VETERINARY RECEPTIONIST") read poorly. */
function fixTitle(t) {
  if (!t) return null;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters && letters === letters.toUpperCase() && letters.length > 3) return fixCase(t);
  return t;
}

// ===========================================================================
// Row -> application
// ===========================================================================

const ZIP_QUESTION = /zip\s*code|where do you (live|reside)|what city.*(reside|live)|what state/i;

function screeningAnswers(row) {
  const out = [];
  for (let i = 1; i <= 15; i++) {
    const q = clean(row[`Qualification ${i}`]);
    if (!q) continue;
    out.push({
      question: q,
      answer: clean(row[`Qualification ${i} Answer`]),
      match: clean(row[`Qualification ${i} Match`]),
    });
  }
  return out;
}

function zipFrom(answers, candidateLocation) {
  for (const a of answers) {
    if (!a.answer || !ZIP_QUESTION.test(a.question)) continue;
    const m = a.answer.match(/\b(\d{5})\b/);
    if (m) return m[1];
  }
  const m = (candidateLocation || "").match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

// Indeed's own pipeline status -> our stage + intake triage state.
const STATUS_MAP = {
  "awaiting review": { stage: null, review: "pending" },
  reviewed: { stage: "Reviewed", review: "accepted" },
  contacting: { stage: "Contacting", review: "accepted" },
  hired: { stage: "Hired", review: "accepted" },
  rejected: { stage: "Declined", review: "declined" },
};

const INTEREST = { yes: "Yes", maybe: "Maybe", reject: "Reject" };

function pipelineFor(jobTitle, status) {
  if ((status || "").toLowerCase() === "hired") return "Hired";
  return /remote/i.test(jobTitle || "") ? "Remote CSR" : "All In House Positions";
}

function toApplication(row) {
  const answers = screeningAnswers(row);
  const rawName = clean(row.name) || "";
  const name = fixCase(cleanName(rawName));
  return {
    name,
    nameKey: nameKey(rawName),
    email: normEmail(row.email),
    phone: formatPhone(row.phone),
    phoneKey: phoneKey(row.phone),
    date: /^\d{4}-\d{2}-\d{2}$/.test(row.date || "") ? row.date : null,
    externalStatus: clean(row.status),
    candidateLocation: clean(row["candidate location"]),
    relevantExperience: clean(row["relevant experience"]),
    education: clean(row.education),
    jobTitle: fixTitle(clean(row["job title"])),
    jobLocation: clean(row["job location"]),
    interestLevel: INTEREST[(row["interest level"] || "").toLowerCase()] ?? null,
    sourceDetail: clean(row.source),
    answers,
    postalCode: zipFrom(answers, row["candidate location"]),
  };
}

// ===========================================================================
// Group applications into unique people
// ===========================================================================
function groupPeople(apps) {
  const groups = new Map();
  const byPhone = new Map(); // phoneKey -> [groupId]
  for (const a of apps) {
    let gid = null;
    if (a.phoneKey) {
      // Same phone only merges when the name agrees (shared household lines).
      for (const id of byPhone.get(a.phoneKey) ?? []) {
        if (groups.get(id).nameKey === a.nameKey) {
          gid = id;
          break;
        }
      }
    }
    if (!gid && !a.phoneKey && a.nameKey) {
      for (const [id, g] of groups) {
        if (g.nameKey === a.nameKey && !g.phoneKey) {
          gid = id;
          break;
        }
      }
    }
    if (!gid) {
      gid = `g${groups.size}`;
      groups.set(gid, { nameKey: a.nameKey, phoneKey: a.phoneKey, apps: [] });
      if (a.phoneKey) byPhone.set(a.phoneKey, [...(byPhone.get(a.phoneKey) ?? []), gid]);
    }
    groups.get(gid).apps.push(a);
  }
  // Newest application first; it drives the scalar profile columns.
  for (const g of groups.values()) {
    g.apps.sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));
  }
  return [...groups.values()];
}

/** Collapse a person's applications into one profile (newest wins per field). */
function profileFor(group) {
  const apps = group.apps;
  const latest = apps[0];
  const firstSet = (key) => apps.find((a) => a[key])?.[key] ?? null;
  const name = firstSet("name") ?? latest.name;
  const { first, last } = splitName(name);
  return {
    name,
    first,
    last,
    email: firstSet("email"),
    phone: firstSet("phone"),
    postalCode: firstSet("postalCode"),
    candidateLocation: firstSet("candidateLocation"),
    relevantExperience: firstSet("relevantExperience"),
    education: firstSet("education"),
    targetTitle: latest.jobTitle,
    jobLocation: latest.jobLocation,
    interestLevel: latest.interestLevel,
    externalStatus: latest.externalStatus,
    sourceDetail: latest.sourceDetail,
    applicationDate: latest.date,
    answers: apps.find((a) => a.answers.length)?.answers ?? [],
    history: apps.map((a) => ({
      date: a.date,
      job_title: a.jobTitle,
      job_location: a.jobLocation,
      status: a.externalStatus,
      interest_level: a.interestLevel,
      source: "Indeed",
    })),
    ...(STATUS_MAP[(latest.externalStatus || "").toLowerCase()] ?? {
      stage: null,
      review: "accepted",
    }),
    pipeline: pipelineFor(latest.jobTitle, latest.externalStatus),
  };
}

// ===========================================================================
// SQL helpers
//
// The Supabase Management API charges ~0.25 s per statement, so this emits
// SET-BASED SQL: every person is staged as one JSON record and the whole
// import runs as a handful of statements over a staging table.
// ===========================================================================
const qj = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

// ===========================================================================
// Main
// ===========================================================================
const apps = parseCsv(readFileSync(CSV_PATH, "utf-8")).map(toApplication);
const people = JSON.parse(readFileSync(PEOPLE_JSON, "utf-8"));

// Index the existing roster/pipeline for matching.
const exByEmail = new Map();
const exByPhone = new Map();
const exByName = new Map();
for (const p of people) {
  const e = normEmail(p.email);
  if (e && !exByEmail.has(e)) exByEmail.set(e, p);
  const ph = phoneKey(p.phone_mobile);
  if (ph) exByPhone.set(ph, [...(exByPhone.get(ph) ?? []), p]);
  const nk = nameKey(p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`);
  if (nk) exByName.set(nk, [...(exByName.get(nk) ?? []), p]);
}

const ROSTER = new Set(["employee", "contractor", "former"]);
/** Prefer a roster record, then one that already has a recruiting row. */
function pickBest(cands) {
  return (
    cands.find((c) => ROSTER.has(c.status)) ??
    cands.find((c) => c.has_recruiting) ??
    cands[0]
  );
}

function matchExisting(profile, group) {
  if (profile.email && exByEmail.has(profile.email))
    return { person: exByEmail.get(profile.email), how: "email" };
  for (const a of group.apps) {
    if (a.phoneKey && exByPhone.has(a.phoneKey))
      return { person: pickBest(exByPhone.get(a.phoneKey)), how: "phone" };
  }
  if (group.nameKey && exByName.has(group.nameKey)) {
    const cands = exByName.get(group.nameKey);
    return { person: pickBest(cands), how: cands.length > 1 ? "name-ambiguous" : "name" };
  }
  return null;
}

const groups = groupPeople(apps);
const staged = [];
const report = { inserted: [], updatedCandidates: [], updatedRoster: [], ambiguous: [] };
const usedPersonIds = new Set();

for (const group of groups) {
  const p = profileFor(group);
  const match = matchExisting(p, group);

  if (match && usedPersonIds.has(match.person.id)) {
    // Two CSV groups resolved to the same person (e.g. one had no phone).
    // The first group already carried this person's data, so skip the second.
    report.ambiguous.push({ name: p.name, reason: "duplicate match", id: match.person.id });
    continue;
  }
  if (match) usedPersonIds.add(match.person.id);

  const isRoster = match && ROSTER.has(match.person.status);
  const record = {
    id: match ? match.person.id : randomUUID(),
    op: !match ? "insert" : isRoster ? "update_roster" : "update_candidate",
    first_name: p.first,
    last_name: p.last,
    full_name: p.name,
    email: p.email,
    phone_mobile: p.phone,
    postal_code: p.postalCode,
    target_title: p.targetTitle,
    pipeline: p.pipeline,
    stage: p.stage,
    source_detail: p.sourceDetail,
    application_date: p.applicationDate,
    review_status: p.review,
    candidate_location: p.candidateLocation,
    relevant_experience: p.relevantExperience,
    education: p.education,
    job_location: p.jobLocation,
    interest_level: p.interestLevel,
    external_status: p.externalStatus,
    screening_answers: p.answers,
    application_history: p.history,
    // Applications rendered for an existing staff member's notes field.
    history_note:
      "[Indeed applications]\n" +
      p.history
        .map(
          (h) =>
            `${h.date ?? "?"} — ${h.job_title ?? "?"}${h.job_location ? ` (${h.job_location})` : ""}: ${h.status ?? "?"}`,
        )
        .join("\n"),
  };
  staged.push(record);

  if (record.op === "insert") {
    report.inserted.push({ name: p.name, title: p.targetTitle, review: p.review });
  } else {
    const entry = {
      name: p.name,
      matchedAs: match.person.full_name,
      how: match.how,
      applications: p.history.length,
    };
    if (isRoster) report.updatedRoster.push({ ...entry, status: match.person.status });
    else report.updatedCandidates.push(entry);
    if (match.how === "name-ambiguous") report.ambiguous.push({ name: p.name, id: match.person.id });
  }
}

// ===========================================================================
// Emit SQL: staging table -> view -> five set-based DML statements
// ===========================================================================
const STAGE_TABLE = "greendogops.indeed_import_stage";
const STAGE_VIEW = "greendogops.indeed_import_rows";

const setupSql = `set search_path = greendogops, public;
drop view if exists ${STAGE_VIEW};
create table if not exists ${STAGE_TABLE} (payload jsonb not null);
truncate ${STAGE_TABLE};
create view ${STAGE_VIEW} as
select
  (e->>'id')::uuid                                as id,
  e->>'op'                                        as op,
  e->>'first_name'                                as first_name,
  e->>'last_name'                                 as last_name,
  e->>'full_name'                                 as full_name,
  e->>'email'                                     as email,
  e->>'phone_mobile'                              as phone_mobile,
  e->>'postal_code'                               as postal_code,
  e->>'target_title'                              as target_title,
  e->>'pipeline'                                  as pipeline,
  e->>'stage'                                     as stage,
  e->>'source_detail'                             as source_detail,
  nullif(e->>'application_date', '')::date        as application_date,
  e->>'review_status'                             as review_status,
  e->>'candidate_location'                        as candidate_location,
  e->>'relevant_experience'                       as relevant_experience,
  e->>'education'                                 as education,
  e->>'job_location'                              as job_location,
  e->>'interest_level'                            as interest_level,
  e->>'external_status'                           as external_status,
  coalesce(e->'screening_answers', '[]'::jsonb)   as screening_answers,
  coalesce(e->'application_history', '[]'::jsonb) as application_history,
  e->>'history_note'                              as history_note
from ${STAGE_TABLE} st, lateral jsonb_array_elements(st.payload) e;
`;

// Columns the import owns outright — always refreshed from the export.
const OWNED_COLUMNS = `
  candidate_location  = excluded.candidate_location,
  relevant_experience = excluded.relevant_experience,
  education           = excluded.education,
  job_location        = excluded.job_location,
  interest_level      = excluded.interest_level,
  external_status     = excluded.external_status,
  source_detail       = excluded.source_detail,
  screening_answers   = excluded.screening_answers,
  application_history = excluded.application_history`;

// Recruiter-owned columns are only filled when still blank. review_status is
// the one exception: a record still sitting in our Review Queue was never
// triaged here, so the decision already made on the job board is adopted.
const RECRUITING_UPSERT = (op) => `
insert into greendogops.person_recruiting (
  person_id, target_title, pipeline, stage, source, source_detail,
  application_date, review_status, candidate_location,
  relevant_experience, education, job_location, interest_level, external_status,
  screening_answers, application_history
)
select
  id, target_title, pipeline, stage, 'Indeed', source_detail,
  application_date, review_status, candidate_location,
  relevant_experience, education, job_location, interest_level, external_status,
  screening_answers, application_history
from ${STAGE_VIEW} where op = '${op}'
on conflict (person_id) do update set
  target_title     = coalesce(nullif(person_recruiting.target_title, ''), excluded.target_title),
  pipeline         = coalesce(nullif(person_recruiting.pipeline, ''), excluded.pipeline),
  stage            = coalesce(nullif(person_recruiting.stage, ''), excluded.stage),
  source           = coalesce(nullif(person_recruiting.source, ''), excluded.source),
  application_date = greatest(person_recruiting.application_date, excluded.application_date),
  review_status    = case when person_recruiting.review_status = 'pending'
                          then excluded.review_status
                          else person_recruiting.review_status end,${OWNED_COLUMNS};`;

const applySql = `set search_path = greendogops, public;
begin;

-- 1. New candidates.
insert into greendogops.person (
  id, status, first_name, last_name, full_name, email, phone_mobile, postal_code
)
select id, 'applicant', first_name, last_name, full_name, email, phone_mobile, postal_code
from ${STAGE_VIEW} where op = 'insert'
on conflict (id) do nothing;
${RECRUITING_UPSERT("insert")}

-- 2. Existing candidates: fill blanks only, then refresh the owned columns.
update greendogops.person p set
  first_name   = coalesce(nullif(p.first_name, ''), r.first_name),
  last_name    = coalesce(nullif(p.last_name, ''), r.last_name),
  full_name    = coalesce(nullif(p.full_name, ''), r.full_name),
  email        = coalesce(nullif(p.email, ''), r.email),
  phone_mobile = coalesce(nullif(p.phone_mobile, ''), r.phone_mobile),
  postal_code  = coalesce(nullif(p.postal_code, ''), r.postal_code)
from ${STAGE_VIEW} r
where r.op = 'update_candidate' and p.id = r.id;
${RECRUITING_UPSERT("update_candidate")}

-- 3. Current/former staff are never re-added as candidates: fill the gaps on
--    their person record and log the applications in their notes.
update greendogops.person p set
  phone_mobile = coalesce(nullif(p.phone_mobile, ''), r.phone_mobile),
  postal_code  = coalesce(nullif(p.postal_code, ''), r.postal_code),
  notes = case
    when coalesce(p.notes, '') like '%[Indeed applications]%' then p.notes
    else concat_ws(E'\\n\\n', nullif(p.notes, ''), r.history_note)
  end
from ${STAGE_VIEW} r
where r.op = 'update_roster' and p.id = r.id;

commit;
`;

const cleanupSql = `set search_path = greendogops, public;
drop view if exists ${STAGE_VIEW};
drop table if exists ${STAGE_TABLE};
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "00_setup.sql"), setupSql);

const files = ["00_setup.sql"];
for (let i = 0, n = 0; i < staged.length; i += CHUNK_SIZE, n++) {
  const name = `01_data_${String(n).padStart(3, "0")}.sql`;
  writeFileSync(
    join(OUT_DIR, name),
    `insert into ${STAGE_TABLE} (payload) values (${qj(staged.slice(i, i + CHUNK_SIZE))});\n`,
  );
  files.push(name);
}
writeFileSync(join(OUT_DIR, "02_apply.sql"), applySql);
writeFileSync(join(OUT_DIR, "03_cleanup.sql"), cleanupSql);
files.push("02_apply.sql", "03_cleanup.sql");
writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

console.log(`CSV applications : ${apps.length}`);
console.log(`Unique people    : ${groups.length}`);
console.log(`  new candidates : ${report.inserted.length}`);
console.log(`  updated cands  : ${report.updatedCandidates.length}`);
console.log(`  roster updates : ${report.updatedRoster.length} (employee/contractor/former)`);
console.log(`  ambiguous      : ${report.ambiguous.length}`);
console.log(`SQL files        : ${files.length} — apply in order with scripts/supabase-sql.sh -f`);

