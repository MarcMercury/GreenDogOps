#!/usr/bin/env node
/**
 * Cross-reference the "GDD Staff Schedule 2026" sheet against HR.
 *
 *   node scripts/reconcile_schedule_roster.mjs                 # current + next month
 *   node scripts/reconcile_schedule_roster.mjs September October
 *
 * Three questions, one report:
 *   1. Does every role row in the schedule have a matching role option in the
 *      app (sched_role) and a matching job title family in HR?
 *   2. Does every name on the schedule resolve to a person? Near misses
 *      (shortened first names, added middle names, typos) are proposed rather
 *      than applied, because grid_name is an identity key — see
 *      lib/hr/wheniwork.ts.
 *   3. Which of those people are scheduled into work their HR title says they
 *      do not do?
 *
 * Read-only. Emits a cleanup list; apply nothing without a human.
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "./lib/google-auth.mjs";
import { extractTab } from "./read_schedule_sheet.mjs";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Sheet role label -> the grid line it feeds. Mirror of src/lib/sheets/schedule.ts. */
const ROLE_MAP = {
  vetsurgery: { dept: "SURGERY", role: "DVM" },
  vetap: { dept: "AP", role: "DVM" },
  "2ndvetap": { dept: "AP", role: "DVM" },
  vetnad: { dept: "NAD/VE/UC", role: "DVM" },
  "2ndvetnad": { dept: "NAD/VE/UC", role: "DVM" },
  vetim: { dept: "IM", role: "DVM" },
  vetexotics: { dept: "EXOTICS", role: "DVM" },
  vetmpmv: { dept: "MPMV", role: "DVM" },
  vetcardio: { dept: "CARDIO", role: "DVM" },
  surgerylead: { dept: "SURGERY", role: "Surgery Lead" },
  surgerytech: { dept: "SURGERY", role: "Surgery Tech" },
  surgerytech1: { dept: "SURGERY", role: "Surgery Tech" },
  surgerytech2: { dept: "SURGERY", role: "Surgery Tech" },
  aplead: { dept: "AP", role: "AP Lead" },
  aptech: { dept: "AP", role: "AP Tech" },
  remoteaptech: { dept: "AP", role: "Remote AP Tech" },
  danad: { dept: "NAD/VE/UC", role: "DA - NAD" },
  datraining: { dept: "NAD/VE/UC", role: "DA - Training" },
  clinictech: { dept: "NAD/VE/UC", role: "Clinic Tech" },
  clinictechfloat: { dept: "NAD/VE/UC", role: "Clinic Tech" },
  clinictechmiddtfloat: { dept: "NAD/VE/UC", role: "Clinic Tech" },
  clinictechda: { dept: "NAD/VE/UC", role: "Clinic Tech" },
  floatlead: { dept: "NAD/VE/UC", role: "Float / Lead" },
  leadtech: { dept: "NAD/VE/UC", role: "Lead Tech" },
  dentals: { dept: "NAD/VE/UC", role: "Dentals" },
  dentalstrainee: { dept: "NAD/VE/UC", role: "Dentals (trainee)" },
  imtechda: { dept: "IM", role: "IM Tech/DA" },
  imtech: { dept: "IM", role: "IM Tech" },
  exotictechda: { dept: "EXOTICS", role: "Exotic Tech/DA" },
  exoticstech: { dept: "EXOTICS", role: "Exotics Tech" },
  mpmvtech: { dept: "MPMV", role: "MPMV Tech" },
  mpmvmedteam: { dept: "MPMV MED TEAM", role: null },
  csr: { dept: "CSR", role: "CSR" },
  csrlead: { dept: "CSR", role: "CSR Lead" },
  csrtrainee: { dept: "CSR", role: "CSR trainee" },
  fac: { dept: "CSR", role: "FAC" },
  referralc: { dept: "CSR", role: "Referral C" },
  referralcmarketingclientsupport: { dept: "CSR", role: "Referral C" },
  inhouseadminmarketingassit: { dept: "CSR", role: "Admin/Mrkt Asst." },
  rcsrmanager: { dept: "REMOTE", role: "RCSR Manager" },
  morninglead: { dept: "REMOTE", role: "Morning Lead" },
  mid: { dept: "REMOTE", role: "Mid" },
  apsx: { dept: "REMOTE", role: "AP/SX" },
  support: { dept: "REMOTE", role: "Support" },
  closer: { dept: "REMOTE", role: "Closer" },
  float: { dept: "REMOTE", role: "Float" },
  textingtidio: { dept: "REMOTE", role: "Texting / Tidio" },
  admin: { dept: "REMOTE", role: null },
  adminbackend: { dept: "REMOTE", role: null },
  manager: { dept: "MANAGEMENT", role: "Manager" },
  inhouseadmin: { dept: "Admin/Asst/ Inventory", role: "Inventory/ Admin" },
  inventory: { dept: "Admin/Asst/ Inventory", role: "Inventory/ Admin" },
  officeadmin: { dept: "Admin/Asst/ Inventory", role: "Inventory/ Admin" },
  schadmin: { dept: "Admin/Asst/ Inventory", role: "Inventory/ Admin" },
};

const SECTION_HEADERS = {
  vetsurgery: "SURGERY", vetap: "AP", vetnad: "NAD/VE/UC", vetim: "IM",
  vetexotics: "EXOTICS", vetmpmv: "MPMV", vetcardio: "CARDIO",
  lateclinicschedule: "NAD/VE/UC", remoteschdule: "REMOTE", remoteschedule: "REMOTE",
};
const SECTION_ROLES = {
  dvm: "DVM", intern: "Intern", externstudent: "Extern/Student", exrternstudent: "Extern/Student",
};
const HEADER_ONLY = new Set(["lateclinicschedule", "remoteschdule", "remoteschedule", "role"]);

/** What kind of work a schedule row is. Compared against the HR job title. */
function roleFamily(label) {
  const k = labelKey(label);
  if (SECTION_ROLES[k] === "DVM" || /^2?n?d?vet/.test(k)) return "doctor";
  if (k === "intern" || k === "exrternstudent" || k === "externstudent") return "student";
  const spec = ROLE_MAP[k];
  if (!spec) return null;
  if (spec.role === "DVM") return "doctor";
  if (spec.dept === "REMOTE") return "remote";
  if (spec.dept === "CSR") return spec.role === "Admin/Mrkt Asst." ? "admin" : "csr";
  if (spec.dept === "MANAGEMENT" || spec.dept === "Admin/Asst/ Inventory") return "admin";
  if (spec.dept === "MPMV MED TEAM") return "mpmv";
  return "tech";
}

/** What kind of work an HR job title describes. */
function titleFamily(title) {
  const t = String(title ?? "").toLowerCase();
  if (!t || t === "none" || t === "n/a") return null;
  if (/dvm|veterinarian|surgeon|cardiolog|ophthalmolog|chief of staff|clinical director|veterinary education|vet\/consultant|videologist/.test(t)) {
    return "doctor";
  }
  if (/intern|extern|student/.test(t)) return "student";
  if (/rcsr|remote csr|remote hr|remote admin/.test(t)) return "remote";
  if (/csr|referral coordinator/.test(t)) return "csr";
  if (/rvt|veterinary assistant|vet assistant|technician|clinic supervisor/.test(t)) return "tech";
  if (/my pet/.test(t)) return "mpmv";
  if (/director|manager|administrator|accountant|marketing|facilities|counsel|cco|cmo|coo|designer|writer|consultant/.test(t)) {
    return "admin";
  }
  return null;
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const labelKey = (label) => String(label).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Must stay in step with src/lib/sheets/common.ts nameKey(). */
function nameKey(name) {
  return clean(name)
    .replace(/\d+\s*$/, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bdr\.?\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

const RANK = { employee: 0, contractor: 1, former: 2, applicant: 3, prospect: 4 };

/**
 * Why a sheet name might be this person. Returns null when it plainly is not.
 * Ordered most to least trustworthy.
 */
function nearMatch(sheetKey, person) {
  const keys = [person.gridKey, person.fullKey].filter(Boolean);
  const s = sheetKey.split(" ");
  for (const key of keys) {
    if (!key) continue;
    const h = key.split(" ");
    if (s.length > 1 && h.length > 1) {
      const sameLast = s[s.length - 1] === h[h.length - 1];
      if (sameLast) {
        const a = s[0];
        const b = h[0];
        if (a === b) return "same name, extra middle/second name";
        if (a.startsWith(b) || b.startsWith(a)) return "shortened first name";
        if (lev(a, b) <= 2) return "first name spelled differently";
        if (a[0] === b[0]) return "same surname, same initial";
      }
      if (s.every((t) => h.includes(t))) return "HR name has extra name parts";
      if (h.every((t) => s.includes(t))) return "sheet name has extra name parts";
    }
    if (s.length === 1 && h.includes(s[0])) return "sheet gives only one name";
    if (h.length === 1 && s.includes(h[0])) return "HR name is a single word";
    if (lev(sheetKey, key) <= 2 && Math.min(sheetKey.length, key.length) > 5) {
      return "spelling differs by a character or two";
    }
  }
  return null;
}

async function fetchAll(supabase, table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

// --- load ------------------------------------------------------------------

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
const supabase = createClient(url, key, {
  auth: { persistSession: false },
  db: { schema: "greendogops" },
});

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const tabs = args.length
  ? args
  : [MONTH_NAMES[new Date().getMonth()], MONTH_NAMES[(new Date().getMonth() + 1) % 12]];

const placements = [];
for (const tab of tabs) placements.push(...(await extractTab(tab, "")));

const people = await fetchAll(supabase, "person", "id, full_name, first_name, last_name, grid_name, status");
const employment = await fetchAll(supabase, "person_employment", "person_id, adp_job_title, offer_title");
const roles = await fetchAll(supabase, "sched_role", "name, department_id, is_active");
const depts = await fetchAll(supabase, "sched_department", "id, name");

const titleByPerson = new Map(
  employment.map((e) => [e.person_id, clean(e.adp_job_title || e.offer_title) || null]),
);
const deptName = new Map(depts.map((d) => [d.id, d.name]));
const roleOptions = new Set(roles.map((r) => `${deptName.get(r.department_id)}|${r.name}`));

for (const p of people) {
  p.gridKey = nameKey(p.grid_name);
  p.fullKey = nameKey(p.full_name);
  p.title = titleByPerson.get(p.id) ?? null;
  p.titleFamily = titleFamily(p.title);
}
const byKey = new Map();
for (const p of [...people].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9))) {
  for (const k of [p.gridKey, p.fullKey]) {
    if (k && !byKey.has(k)) byKey.set(k, p);
  }
}

// --- roll the sheet up -----------------------------------------------------

const roleRows = new Map(); // sheet label -> { n, section, shifts:Set }
const sheetPeople = new Map(); // sheet name -> { n, roles:Set, families:Set }
let section = null;
for (const p of placements) {
  const k = labelKey(p.role);
  if (SECTION_HEADERS[k]) section = SECTION_HEADERS[k];
  else if (ROLE_MAP[k]) section = ROLE_MAP[k].dept;
  if (HEADER_ONLY.has(k)) continue;

  const row = roleRows.get(p.role) ?? { n: 0, sections: new Set(), shifts: new Set() };
  row.n += 1;
  if (section) row.sections.add(section);
  row.shifts.add(p.shift);
  roleRows.set(p.role, row);

  const who = sheetPeople.get(p.person) ?? { n: 0, roles: new Set(), families: new Set() };
  who.n += 1;
  who.roles.add(p.role);
  const fam = roleFamily(p.role) ?? (SECTION_ROLES[k] && section ? "tech" : null);
  if (fam) who.families.add(fam);
  sheetPeople.set(p.person, who);
}

// --- report ----------------------------------------------------------------

const line = (s = "") => console.log(s);
const rule = (t) => {
  line();
  line(`=== ${t} ${"=".repeat(Math.max(0, 72 - t.length))}`);
};

line(`Schedule <-> HR reconciliation — tabs: ${tabs.join(", ")}`);
line(`${placements.length} placements, ${roleRows.size} distinct role rows, ${sheetPeople.size} distinct names`);

rule("1. ROLE ROW INVENTORY — every role the sheet staffs");
const unmappedRoles = [];
const noOption = [];
const titleFamilies = new Set(
  people
    .filter((p) => p.status === "employee" || p.status === "contractor")
    .map((p) => p.titleFamily)
    .filter(Boolean),
);
line("  count  sheet role row                     -> app department / role        checks");
for (const [label, info] of [...roleRows].sort((a, b) => b[1].n - a[1].n)) {
  const k = labelKey(label);
  const shared = SECTION_ROLES[k];
  const spec = shared ? { dept: [...info.sections].join(" + "), role: shared } : ROLE_MAP[k];
  if (!spec) {
    unmappedRoles.push([label, info]);
    line(`  ${String(info.n).padStart(5)}  ${label.padEnd(34)} -> NOT MAPPED`);
    continue;
  }
  const target = `${spec.dept} / ${spec.role ?? "(unroled line)"}`;
  const flags = [];
  const missing = shared
    ? [...info.sections].filter((d) => !roleOptions.has(`${d}|${shared}`))
    : spec.role && !roleOptions.has(`${spec.dept}|${spec.role}`)
      ? [spec.dept]
      : [];
  if (missing.length) {
    flags.push(`NO ROLE OPTION in ${missing.join(", ")}`);
    noOption.push([label, spec, info]);
  }
  const fam = roleFamily(label) ?? (shared ? "tech" : null);
  if (fam && !titleFamilies.has(fam)) flags.push(`NO HR TITLE COVERS "${fam}"`);
  line(`  ${String(info.n).padStart(5)}  ${label.padEnd(34)} -> ${target.padEnd(34)} ${flags.join(", ")}`);
}
line();
line(
  unmappedRoles.length
    ? `  ${unmappedRoles.length} role rows do not map — their shifts are NOT imported.`
    : "  Every role row maps to a department + role, so nothing is dropped.",
);
if (noOption.length) line(`  ${noOption.length} map to a role the app does not offer.`);

rule("2. ROLE OPTIONS IN THE APP THAT THE SHEET NEVER STAFFS");
const usedOptions = new Set();
for (const [label, info] of roleRows) {
  const k = labelKey(label);
  if (SECTION_ROLES[k]) {
    for (const d of info.sections) usedOptions.add(`${d}|${SECTION_ROLES[k]}`);
    continue;
  }
  const spec = ROLE_MAP[k];
  if (spec?.role) usedOptions.add(`${spec.dept}|${spec.role}`);
}
for (const opt of [...roleOptions].sort()) {
  if (!usedOptions.has(opt)) line(`  ${opt.replace("|", " / ")}`);
}

rule("3. NAMES ON THE SCHEDULE THAT DO NOT MATCH A PERSON");
const exact = [];
const near = [];
const none = [];
for (const [name, info] of [...sheetPeople].sort((a, b) => b[1].n - a[1].n)) {
  const k = nameKey(name);
  const hit = byKey.get(k);
  if (hit) {
    exact.push([name, info, hit]);
    continue;
  }
  const cands = [];
  for (const p of people) {
    const why = nearMatch(k, p);
    if (why) cands.push({ p, why });
  }
  cands.sort((a, b) => (RANK[a.p.status] ?? 9) - (RANK[b.p.status] ?? 9));
  if (cands.length) near.push([name, info, cands]);
  else none.push([name, info]);
}
line(`  ${exact.length} names match a person outright.`);
line();
line(`  -- ${near.length} near misses (propose a grid_name, do not guess) --`);
for (const [name, info, cands] of near) {
  line(`  ${String(info.n).padStart(4)}x  ${name}`);
  line(`          roles: ${[...info.roles].join(", ")}`);
  for (const c of cands.slice(0, 4)) {
    line(`          -> ${c.p.full_name} [${c.p.status}${c.p.title ? ", " + c.p.title : ""}]  (${c.why})`);
  }
}
line();
line(`  -- ${none.length} with no candidate at all --`);
for (const [name, info] of none) {
  line(`  ${String(info.n).padStart(4)}x  ${name}   roles: ${[...info.roles].join(", ")}`);
}

rule("4. MATCHED, BUT THE PERSON RECORD NEEDS WORK");
const notActive = exact.filter(([, , p]) => p.status !== "employee" && p.status !== "contractor");
const noTitle = exact.filter(([, , p]) => (p.status === "employee" || p.status === "contractor") && !p.title);
// nameKey() drops a trailing digit, so "Dr. Geist1" still matches — but the
// cell is a copy/paste artifact and should be cleaned in the sheet.
const dirtyCells = exact.filter(([name]) => /\d\s*$/.test(name));
// Matched on full_name with no grid_name, and the two strings are not even
// identical: the next HR spelling change silently drops these people.
const noGridName = exact.filter(
  ([name, , p]) => !p.grid_name && clean(name).toLowerCase() !== clean(p.full_name).toLowerCase(),
);
for (const [name, info, p] of notActive) {
  line(`  ${String(info.n).padStart(4)}x  ${name} -> ${p.full_name} is '${p.status}', not an employee`);
}
for (const [name, info, p] of noTitle) {
  line(`  ${String(info.n).padStart(4)}x  ${name} -> ${p.full_name} has no job title on file`);
}
for (const [name, info, p] of dirtyCells) {
  line(`  ${String(info.n).padStart(4)}x  ${JSON.stringify(name)} -> ${p.full_name}  stray character in the sheet cell`);
}
for (const [name, info, p] of noGridName) {
  line(`  ${String(info.n).padStart(4)}x  ${name} -> ${p.full_name} has no grid_name; the match is not pinned`);
}
if (!notActive.length && !noTitle.length && !dirtyCells.length && !noGridName.length) line("  (none)");

rule("5. SCHEDULED INTO WORK THEIR HR TITLE DOES NOT COVER");
let mismatches = 0;
for (const [name, info, p] of exact) {
  if (!p.titleFamily || !info.families.size) continue;
  if (info.families.has(p.titleFamily)) continue;
  if (p.titleFamily === "admin" || info.families.has("student")) continue;
  mismatches += 1;
  line(`  ${String(info.n).padStart(4)}x  ${name} — HR title "${p.title}" (${p.titleFamily})`);
  line(`          scheduled as: ${[...info.roles].join(", ")} (${[...info.families].join(", ")})`);
}
if (!mismatches) line("  (none)");

rule("6. ACTIVE STAFF WHO NEVER APPEAR ON THE SCHEDULE");
// Someone proposed as a near-miss IS on the schedule, just under another
// spelling — listing them here as absent would send HR chasing a ghost.
const proposed = new Set(near.flatMap(([, , cands]) => cands.map((c) => c.p.id)));
const scheduled = new Set(exact.map(([, , p]) => p.id));
const idle = people
  .filter(
    (p) =>
      (p.status === "employee" || p.status === "contractor") &&
      !scheduled.has(p.id) &&
      !proposed.has(p.id),
  )
  .sort((a, b) => String(a.title).localeCompare(String(b.title)));
for (const p of idle) line(`  ${p.full_name}  [${p.status}${p.title ? ", " + p.title : ", no title"}]`);
const activeCount = people.filter((p) => p.status === "employee" || p.status === "contractor").length;
line(`  (${idle.length} of ${activeCount} active staff)`);

rule("7. DUPLICATE PERSON ROWS AMONG ACTIVE STAFF");
const dupes = new Map();
for (const p of people) {
  if (p.status !== "employee" && p.status !== "contractor") continue;
  const k = p.fullKey;
  if (!k) continue;
  if (!dupes.has(k)) dupes.set(k, []);
  dupes.get(k).push(p);
}
let dupCount = 0;
for (const [, rows] of dupes) {
  if (rows.length < 2) continue;
  dupCount += 1;
  line(`  ${rows[0].full_name}: ${rows.length} rows — ${rows.map((r) => `${r.status}/${r.title ?? "no title"}`).join(", ")}`);
}
if (!dupCount) line("  (none)");
