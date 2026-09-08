#!/usr/bin/env node
/**
 * Reconcile greendogops.person against the "Merit Increase Calculator" HR
 * workbook, which HR keeps current.
 *
 *   SHEET_ID=<id> node scripts/reconcile_hr_roster.mjs            # report only
 *   SHEET_ID=<id> node scripts/reconcile_hr_roster.mjs --sql > .data/hr.sql
 *
 * Source of truth:
 *   "2026 EMP PROFILE DATA"  row 2 = headers, rows 3+ = one CURRENT employee
 *   "Former Employees"       row 2 = headers, rows 3+ = one PAST employee
 *
 * Emits, for review before applying:
 *   - people on the sheet but missing from person            -> insert
 *   - people on the Former tab still marked employee/contractor -> status 'former'
 *   - grid_name / hire-date style gaps                       -> update
 *   - employees in the DB on NEITHER tab                     -> REPORTED ONLY,
 *     never auto-terminated (absence is not proof of separation)
 */
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHEET_ID = process.env.SHEET_ID;
const EMIT_SQL = process.argv.includes("--sql");
const CURRENT_TAB = "2026 EMP PROFILE DATA";
const FORMER_TAB = "Former Employees";

// Rows whose Full Name is one of these are section separators, not people.
const SECTION_MARKERS = new Set(["others", "1099", "new", "inactive 1099", "inactive"]);

function readEnvValue(file, key) {
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith(`${key}=`)) continue;
    let v = line.slice(key.length + 1).trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return null;
}

function sheetsClient() {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    readEnvValue(path.join(ROOT, ".env.local"), "GOOGLE_SERVICE_ACCOUNT_JSON");
  const creds = JSON.parse(raw);
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

async function readTab(sheets, tab) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A1:BZ400`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = data.values ?? [];
  const header = (rows[1] ?? []).map(clean);
  const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  return { rows: rows.slice(2), header, col };
}

/** Lowercase alphabetic tokens; drops honorifics and trailing dedupe digits. */
function tokens(name) {
  return clean(name)
    .replace(/\d+\s*$/, "")
    .toLowerCase()
    .replace(/\bdr\.?\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}
const key = (name) => tokens(name).join(" ");

const sheets = sheetsClient();
const cur = await readTab(sheets, CURRENT_TAB);
const fmr = await readTab(sheets, FORMER_TAB);

const iFull = cur.col("Full Name");
const iGrid = cur.col("GRID NAME");
const iFirst = cur.col("First Name");
const iLast = cur.col("Last Name");
const iDob = cur.col("DOB");
const iZip = cur.col("ZIP CODE");
const iLoc = cur.col("In-House or Remote");
const iTitle = cur.col("ADP Job Title");
const iHire = cur.col("Hire Date");
const iType = cur.col("Type");
const iStatus = cur.col("Status");

const current = [];
for (const r of cur.rows) {
  const full = clean(r[iFull]);
  if (!full || SECTION_MARKERS.has(full.toLowerCase())) continue;
  current.push({
    full_name: full,
    grid_name: clean(r[iGrid]),
    first_name: clean(r[iFirst]),
    last_name: clean(r[iLast]),
    dob: clean(r[iDob]),
    zip: clean(r[iZip]),
    work_location_type: clean(r[iLoc]),
    title: clean(r[iTitle]),
    hire_date: clean(r[iHire]),
    pay_type: clean(r[iType]),
    employment_status: clean(r[iStatus]),
    k: key(full),
  });
}

const fFull = fmr.col("Full Name");
const fLast = fmr.header.findIndex((h) => /last day/i.test(h));
// The bottom of the Former tab has rows pasted in using the CURRENT tab's
// column layout, so only column A (Full Name) is trustworthy there. Presence on
// the tab is what drives the status change; the date is display-only and is
// shown only when the tab's own "Last Day" column really holds a date.
const DATEISH = /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$|^\d{1,2}\/\d{4}$/;
const former = [];
for (const r of fmr.rows) {
  const full = clean(r[fFull]);
  if (!full || SECTION_MARKERS.has(full.toLowerCase())) continue;
  const raw = fLast >= 0 ? clean(r[fLast]) : "";
  former.push({ full_name: full, last_day: DATEISH.test(raw) ? raw : "", k: key(full) });
}

const ACTIVE = new Set(["employee", "contractor"]);

const roster = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/roster_all.json"), "utf8"));
// Several people have more than one person row (an old `former` row plus the
// live one). Prefer the active row so a rehire is not mistaken for someone who
// needs reactivating; the duplicates are reported separately for merging.
const byKeyAll = new Map();
for (const p of roster) {
  for (const n of [p.full_name, p.grid_name]) {
    const kk = key(n ?? "");
    if (!kk) continue;
    if (!byKeyAll.has(kk)) byKeyAll.set(kk, []);
    if (!byKeyAll.get(kk).some((x) => x.id === p.id)) byKeyAll.get(kk).push(p);
  }
}
const byKey = new Map();
for (const [kk, list] of byKeyAll) {
  byKey.set(kk, list.find((p) => ACTIVE.has(p.status)) ?? list[0]);
}
const dupRows = [...byKeyAll.entries()].filter(([, list]) => list.length > 1);
const currentKeys = new Set(current.map((c) => c.k));
const formerKeys = new Set(former.map((f) => f.k));

// Names as written on the STAFF SCHEDULE sheet. grid_name exists to match that
// sheet, so a value already matching it is never replaced by an HR spelling
// that does not (e.g. schedule "Tay Fox" vs HR "Taylor Fox").
const schedulePath = path.join(ROOT, ".data/sheet_September_all.json");
const scheduleNames = new Set(
  fs.existsSync(schedulePath)
    ? JSON.parse(fs.readFileSync(schedulePath, "utf8")).map((p) => key(p.person))
    : [],
);

/** Spreadsheet formula errors must never reach the database. */
const isFormulaError = (v) => /^#(N\/A|REF|VALUE|NAME|DIV\/0|NULL)/i.test(clean(v));

const toInsert = current.filter((c) => !byKey.has(c.k));
const toReactivate = current
  .map((c) => ({ c, p: byKey.get(c.k) }))
  .filter((x) => x.p && !ACTIVE.has(x.p.status));
// Someone listed on BOTH tabs is still current — the 2026 tab wins. A person
// can also appear on the Former tab more than once, so key the result by id.
const toTerminate = [
  ...new Map(
    former
      .filter((f) => !currentKeys.has(f.k))
      .map((f) => ({ f, p: byKey.get(f.k) }))
      .filter((x) => x.p && ACTIVE.has(x.p.status))
      .map((x) => [x.p.id, x]),
  ).values(),
];
const gridGaps = current
  .map((c) => ({ c, p: byKey.get(c.k) }))
  .filter(
    (x) =>
      x.p &&
      x.c.grid_name &&
      !isFormulaError(x.c.grid_name) &&
      clean(x.p.grid_name) !== x.c.grid_name &&
      !(scheduleNames.has(key(x.p.grid_name ?? "")) && !scheduleNames.has(key(x.c.grid_name))),
  );
const orphans = roster.filter(
  (p) =>
    ACTIVE.has(p.status) &&
    !currentKeys.has(key(p.full_name)) &&
    !currentKeys.has(key(p.grid_name ?? "")) &&
    !formerKeys.has(key(p.full_name)),
);

if (!EMIT_SQL) {
  console.log(`sheet "${CURRENT_TAB}"  : ${current.length} current employees`);
  console.log(`sheet "${FORMER_TAB}"       : ${former.length} former employees`);
  console.log(`db employee/contractor : ${roster.filter((p) => ACTIVE.has(p.status)).length}`);
  console.log(`\nmissing from db, will INSERT      : ${toInsert.length}`);
  for (const c of toInsert) console.log(`   + ${c.full_name}  (${c.title || "?"}, hired ${c.hire_date || "?"})`);
  console.log(`\non Former tab but still active    : ${toTerminate.length}`);
  for (const x of toTerminate) console.log(`   - ${x.p.full_name}  [${x.p.status}] last day ${x.f.last_day || "?"}`);
  console.log(`\nnot active in db but on 2026 tab  : ${toReactivate.length}`);
  for (const x of toReactivate) console.log(`   ~ ${x.p.full_name}  [${x.p.status}] -> employee`);
  console.log(`\ngrid_name gaps                    : ${gridGaps.length}`);
  for (const x of gridGaps) console.log(`   * ${x.p.full_name}: '${clean(x.p.grid_name) || "-"}' -> '${x.c.grid_name}'`);
  console.log(`\nACTIVE IN DB, ON NEITHER TAB (review, NOT auto-changed): ${orphans.length}`);
  for (const p of orphans) console.log(`   ? ${p.full_name} [${p.status}]`);
  console.log(`\nDUPLICATE person rows sharing a name (review, NOT auto-merged): ${dupRows.length}`);
  for (const [, list] of dupRows) {
    console.log(`   ! ${list[0].full_name}: ${list.map((p) => `${p.status}`).join(" + ")}`);
  }
  process.exit(0);
}

const q = (v) => (v ? `'${String(v).replace(/'/g, "''")}'` : "null");

/** Sheet "In House" / "Remote" -> greendogops.work_location_type enum. */
function workLocation(v) {
  const s = clean(v).toLowerCase();
  if (s.startsWith("in")) return "in_house";
  if (s.startsWith("rem")) return "remote";
  if (s.startsWith("hyb")) return "hybrid";
  return null;
}
const out = [];
out.push(`-- Generated by scripts/reconcile_hr_roster.mjs on ${new Date().toISOString()}`);
out.push(`-- source: "${CURRENT_TAB}" + "${FORMER_TAB}"`);
out.push("begin;\n");

out.push(`-- ${toTerminate.length} people on the Former Employees tab still marked active.`);
out.push(`-- person_after_change() cascades: deactivates the linked app_user and`);
out.push(`-- clears sched_employee_setting.is_schedulable.`);
for (const x of toTerminate) {
  out.push(
    `update greendogops.person set status = 'former', updated_at = now() where id = '${x.p.id}';  -- ${x.p.full_name}, last day ${x.f.last_day || "?"}`,
  );
}
out.push(`\n-- ${gridGaps.length} grid_name corrections from the sheet's GRID NAME column.`);
for (const x of gridGaps) {
  out.push(
    `update greendogops.person set grid_name = ${q(x.c.grid_name)}, updated_at = now() where id = '${x.p.id}';  -- ${x.p.full_name}`,
  );
}

out.push(`\n-- ${toReactivate.length} people on the 2026 tab that the db does not have as active.`);
for (const x of toReactivate) {
  out.push(
    `update greendogops.person set status = 'employee', updated_at = now() where id = '${x.p.id}';  -- ${x.p.full_name} (was ${x.p.status})`,
  );
}

out.push(`\n-- ${toInsert.length} people on the 2026 tab with no person row.`);
for (const c of toInsert) {
  out.push(`insert into greendogops.person
  (status, first_name, last_name, full_name, grid_name, postal_code, work_location_type, notes)
values ('employee', ${q(c.first_name)}, ${q(c.last_name)}, ${q(c.full_name)}, ${q(c.grid_name)},
        ${q(c.zip)}, ${q(workLocation(c.work_location_type))},
        ${q(`Added from HR "Merit Increase Calculator" sheet. Title: ${c.title || "?"}; hired ${c.hire_date || "?"}; ${c.pay_type || ""} ${c.employment_status || ""}`.trim())});`);
}

out.push("\ncommit;");
console.log(out.join("\n"));
