#!/usr/bin/env node
/**
 * Generate idempotent SQL that loads EVERY staffed row (not just DVMs) from the
 * GDD Staff Schedule sheet into sched_assignment for the September draft weeks.
 *
 *   node scripts/read_schedule_sheet.mjs extract September ""
 *   node scripts/match_sheet_names.mjs .data/sheet_September_all.json
 *   node scripts/import_sheet_staff.mjs > .data/import_staff.sql
 *   ./scripts/supabase-sql.sh -f .data/import_staff.sql
 *
 * Scope guard: only weeks whose week_start is in September AND still in draft
 * are rebuilt. The published Aug-30 week and every October week are left
 * untouched, so October planning is never overwritten. Each target week is
 * cleared and fully reinserted from the sheet, so re-running is safe.
 *
 * Line resolution: a sheet row maps to a (department, role) scheduling line.
 * Repeated rows (six "AP Tech" rows) fan out across that role's lines by their
 * in-block occurrence index; Intern/Extern rows inherit the running VET-*
 * department captured as `section`. Rows without a clean line (day notes,
 * one-off events) are skipped and reported on stderr.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const placements = JSON.parse(
  fs.readFileSync(path.join(ROOT, ".data/sheet_September_all.json"), "utf8"),
);
const nameMap = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/name_map.json"), "utf8"));

const SHEET_LOCATIONS = { SO: "Sherman Oaks", VENICE: "Venice", AETNA: "Van Nuys" };

/** Normalize a sheet role label to lowercase alphanumerics for rule matching. */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Ordered rules: the first whose key is a substring of the normalized label
 * wins. `nth` forces a specific line (1-based) — used where the sheet spells
 * out ordinals ("2nd VET-AP", "Surgery Tech 2"). `section:true` inherits the
 * placement's running VET-* department (Intern / Extern). A null value marks a
 * header row that carries no staffing and must be skipped.
 */
const RULES = [
  ["2nd vet ap", { dept: "AP", role: "DVM", nth: 2 }],
  ["2nd vet nad", { dept: "NAD/VE/UC", role: "DVM", nth: 2 }],
  ["vet surgery", { dept: "SURGERY", role: "DVM", nth: 1 }],
  ["vet ap", { dept: "AP", role: "DVM", nth: 1 }],
  ["vet nad", { dept: "NAD/VE/UC", role: "DVM", nth: 1 }],
  ["vet im", { dept: "IM", role: "DVM", nth: 1 }],
  ["vet exotics", { dept: "EXOTICS", role: "DVM", nth: 1 }],
  ["vet mpmv", { dept: "MPMV", role: "DVM", nth: 1 }],
  ["vet cardio", { dept: "CARDIO", role: "DVM", nth: 1 }],

  ["surgery lead", { dept: "SURGERY", role: "Surgery Lead" }],
  ["surgery tech 1", { dept: "SURGERY", role: "Surgery Tech", nth: 1 }],
  ["surgery tech 2", { dept: "SURGERY", role: "Surgery Tech", nth: 2 }],
  ["surgery tech", { dept: "SURGERY", role: "Surgery Tech" }],

  ["ap lead", { dept: "AP", role: "AP Lead" }],
  ["remote ap tech", { dept: "AP", role: "Remote AP Tech" }],
  ["ap tech", { dept: "AP", role: "AP Tech" }],

  ["da training", { dept: "NAD/VE/UC", role: "DA - Training" }],
  ["2nd da", { dept: "NAD/VE/UC", role: "DA - NAD", nth: 2 }],
  ["da nad", { dept: "NAD/VE/UC", role: "DA - NAD" }],
  ["float lead", { dept: "NAD/VE/UC", role: "Float / Lead" }],
  ["clinic tech", { dept: "NAD/VE/UC", role: "Clinic Tech" }],
  ["dentals trainee", { dept: "NAD/VE/UC", role: "Dentals (trainee)" }],
  ["dentals", { dept: "NAD/VE/UC", role: "Dentals" }],

  ["im tech da", { dept: "IM", role: "IM Tech/DA" }],
  ["im tech", { dept: "IM", role: "IM Tech" }],

  ["exotic tech da", { dept: "EXOTICS", role: "Exotic Tech/DA" }],
  ["exotics tech", { dept: "EXOTICS", role: "Exotics Tech" }],
  ["exotic tech", { dept: "EXOTICS", role: "Exotic Tech/DA" }],

  ["mpmv med team", { dept: "MPMV", role: "MPMV Tech" }],
  ["mpmv tech", { dept: "MPMV", role: "MPMV Tech" }],

  ["referral c", { dept: "CSR", role: "Referral C" }],
  ["in house admin marketing", { dept: "CSR", role: "Admin/Mrkt Asst." }],
  ["marketing assit", { dept: "CSR", role: "Admin/Mrkt Asst." }],
  ["csr lead", { dept: "CSR", role: "CSR Lead" }],
  ["fac", { dept: "CSR", role: "FAC" }],
  ["csr", { dept: "CSR", role: "CSR" }],

  ["rcsr manager", { dept: "REMOTE", role: "RCSR Manager" }],
  ["remote schdule", null],
  ["remote schedule", null],
  ["morning lead", { dept: "REMOTE", role: "Morning Lead" }],
  ["ap sx", { dept: "REMOTE", role: "AP/SX" }],
  ["texting", { dept: "REMOTE", role: "Texting / Tidio" }],
  ["tidio", { dept: "REMOTE", role: "Texting / Tidio" }],
  ["closer", { dept: "REMOTE", role: "Closer" }],
  ["support", { dept: "REMOTE", role: "Support" }],
  ["float", { dept: "REMOTE", role: "Float" }],
  ["mid", { dept: "REMOTE", role: "Mid" }],

  ["manager", { dept: "MANAGEMENT", role: "Manager" }],
  ["inventory", { dept: "Admin/Asst/ Inventory", role: null }],
  ["office admin", { dept: "Admin/Asst/ Inventory", role: null }],
  ["sch admin", { dept: "Admin/Asst/ Inventory", role: null }],
  ["admin backend", { dept: "Admin/Asst/ Inventory", role: null }],
  ["in house admin", { dept: "Admin/Asst/ Inventory", role: null }],

  ["intern", { section: true, role: "Intern" }],
  ["exrtern student", { section: true, role: "Extern/Student" }],
  ["extern student", { section: true, role: "Extern/Student" }],
  ["extern", { section: true, role: "Extern/Student" }],
];

function classify(label) {
  const low = norm(label);
  for (const [kw, rule] of RULES) {
    if (low.includes(kw)) return rule; // may be null (header row)
  }
  return undefined; // no rule
}

/** Sunday that starts the sched_week containing `date`. */
function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

const esc = (s) => String(s).replace(/'/g, "''");

const rows = [];
const skipped = { name: {}, role: {}, header: 0 };

for (const p of placements) {
  const ws = weekStart(p.date);
  if (!ws.startsWith("2026-09")) continue; // Sept draft weeks only; never October
  const rule = classify(p.role);
  if (rule === undefined) {
    skipped.role[p.role] = (skipped.role[p.role] ?? 0) + 1;
    continue;
  }
  if (rule === null) {
    skipped.header++;
    continue;
  }
  const person = nameMap[p.person];
  if (!person) {
    skipped.name[p.person] = (skipped.name[p.person] ?? 0) + 1;
    continue;
  }
  const dept = rule.section ? p.section : rule.dept;
  if (!dept) {
    skipped.role[`${p.role} (no section)`] =
      (skipped.role[`${p.role} (no section)`] ?? 0) + 1;
    continue;
  }
  // Line pick (1-based): explicit ordinal > single section line > in-block
  // occurrence of the raw row. least(pick, cnt) in SQL caps overflow onto the
  // last line rather than dropping the placement.
  const pick = rule.nth ?? (rule.section ? 1 : (p.roleIdx ?? 0) + 1);
  rows.push({
    week_start: ws,
    work_date: p.date,
    dow: new Date(`${p.date}T00:00:00Z`).getUTCDay(),
    dept,
    role: rule.role,
    pick,
    location: SHEET_LOCATIONS[p.location],
    person_id: person.id,
    person_name: person.full_name,
  });
}

const weeks = [...new Set(rows.map((r) => r.week_start))].sort();

console.log(`-- Generated by scripts/import_sheet_staff.mjs on ${new Date().toISOString()}`);
console.log(`-- ${rows.length} placements across ${weeks.length} Sept week(s): ${weeks.join(", ")}`);
console.log(`--
-- Idempotent: for each target week (draft, week_start in September) all
-- assignments are cleared and reinserted from the sheet. Published weeks and
-- October weeks are never touched.
`);
console.log("begin;\n");

for (const ws of weeks) {
  const wr = rows.filter((r) => r.week_start === ws);
  console.log(`-- ================ week of ${ws} (${wr.length} placements) ================`);
  console.log(`do $$
declare
  v_week uuid;
begin
  select id into v_week from greendogops.sched_week
   where week_start = '${ws}' and coalesce(is_template,false) = false
     and status <> 'published'
   limit 1;
  if v_week is null then
    raise notice 'week ${ws}: missing or already published -- skipped';
    return;
  end if;

  delete from greendogops.sched_assignment where week_id = v_week;

  insert into greendogops.sched_assignment
    (week_id, line_id, location_id, person_id, day_of_week, work_date)
  select v_week, ln.id, loc.id, v.person_id::uuid, v.dow::int, v.work_date::date
    from (values`);

  const values = wr.map((r) => {
    const roleVal = r.role === null ? "null" : `'${esc(r.role)}'`;
    return `      ('${esc(r.dept)}', ${roleVal}, ${r.pick}, '${esc(r.location)}', '${r.person_id}', ${r.dow}, '${r.work_date}')`;
  });
  console.log(values.join(",\n"));

  console.log(`    ) as v(dept, role, pick, locname, person_id, dow, work_date)
    join lateral (
      select l.id from (
        select l2.id,
               row_number() over (order by l2.sort_order) rn,
               count(*) over () cnt
          from greendogops.sched_week_line l2
          join greendogops.sched_department d on d.id = l2.department_id and d.name = v.dept
          left join greendogops.sched_role r on r.id = l2.role_id
         where l2.week_id = v_week
           and ((v.role is null and l2.role_id is null) or (r.name = v.role))
      ) l
      where l.rn = least(v.pick, l.cnt)
      limit 1
    ) ln on true
    join lateral (
      select id from greendogops.location where name = v.locname limit 1
    ) loc on true;
end $$;\n`);
}

console.log("commit;");

// ---- stderr summary (not part of the SQL) ----
const skRole = Object.entries(skipped.role).sort((a, b) => b[1] - a[1]);
const skName = Object.entries(skipped.name).sort((a, b) => b[1] - a[1]);
console.error(
  `generated ${rows.length} inserts across ${weeks.length} weeks: ${weeks.join(", ")}`,
);
console.error(`skipped ${skipped.header} header/note row placement(s)`);
if (skRole.length) {
  console.error(`\nUNMAPPED ROLE LABELS (skipped):`);
  for (const [k, v] of skRole) console.error(`  ${String(v).padStart(4)}x  ${k}`);
}
if (skName.length) {
  console.error(`\nUNMATCHED NAMES in Sept weeks (skipped):`);
  for (const [k, v] of skName) console.error(`  ${String(v).padStart(4)}x  ${k}`);
}
