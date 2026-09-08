#!/usr/bin/env node
/**
 * Match the names written in the GDD Staff Schedule sheet to greendogops.person
 * rows. Conservative: a sheet name is only matched when exactly one roster
 * person is a confident hit. Everything else is reported and skipped.
 *
 *   node scripts/match_sheet_names.mjs .data/sheet_September_all.json
 *
 * Handles the sheet's quirks: trailing disambiguation digits ("Raquel Romero1",
 * "Dr. Geist1"), "Dr."/"Dr" prefixes, and doctors written surname-only
 * ("Dr. Rally" -> "Dr. Heather Rally Webb").
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const sheetPath = process.argv[2] ?? path.join(ROOT, ".data/sheet_September_all.json");

const placements = JSON.parse(fs.readFileSync(sheetPath, "utf8"));
const roster = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/roster.json"), "utf8"));

/** Lowercase alphabetic tokens; drops honorifics and trailing dedupe digits. */
function tokens(name) {
  return String(name)
    .replace(/\d+\s*$/, "")
    .toLowerCase()
    .replace(/\bdr\.?\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// person.grid_name IS the schedule-sheet spelling ("Dr. Faro", "Raquel R") and
// is what lib/hr/wheniwork.ts already matches on, so try it before any fuzzy
// token work. Scheduling only ever places employees/contractors, so applicants
// are a last resort and are reported rather than silently used.
const ROSTER_STATUSES = new Set(["employee", "contractor"]);
const rosterTokens = [];
for (const p of roster) {
  const entry = {
    id: p.id,
    full_name: p.full_name,
    grid_name: p.grid_name,
    status: p.status,
    toks: tokens(p.full_name),
    gridToks: p.grid_name ? tokens(p.grid_name) : null,
  };
  rosterTokens.push(entry);
}
const active = rosterTokens.filter((r) => ROSTER_STATUSES.has(r.status));

const sheetNames = [...new Set(placements.map((p) => p.person))].sort();

const matched = new Map();
const ambiguous = [];
const unmatched = [];

for (const raw of sheetNames) {
  const t = tokens(raw);
  if (!t.length) continue;

  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // 0. grid_name — the sheet spelling the roster already records.
  let hits = active.filter((r) => r.gridToks && eq(r.gridToks, t));

  // 1. exact full-name token equality
  if (hits.length !== 1) {
    const e = active.filter((r) => eq(r.toks, t));
    if (e.length) hits = e;
  }

  // 2. sheet tokens are a subset of the roster name ("Dr. Rally" in
  //    "Heather Rally Webb")
  if (hits.length !== 1) {
    const sub = active.filter((r) => t.every((x) => r.toks.includes(x)));
    if (sub.length) hits = sub;
  }

  // 3. first + last token ("Raquel Velez" vs "Raquel V Velez")
  if (hits.length !== 1 && t.length >= 2) {
    const fl = active.filter((r) => r.toks[0] === t[0] && r.toks.at(-1) === t.at(-1));
    if (fl.length) hits = fl;
  }

  if (hits.length === 1) matched.set(raw, hits[0]);
  else if (hits.length > 1) ambiguous.push({ raw, hits: hits.map((h) => h.full_name) });
  else unmatched.push(raw);
}

const placementsMatched = placements.filter((p) => matched.has(p.person)).length;

console.log(`sheet names        : ${sheetNames.length}`);
console.log(`  matched          : ${matched.size}`);
console.log(`  ambiguous        : ${ambiguous.length}`);
console.log(`  unmatched        : ${unmatched.length}`);
console.log(
  `placements covered : ${placementsMatched}/${placements.length} (${Math.round((100 * placementsMatched) / placements.length)}%)`,
);

if (ambiguous.length) {
  console.log("\nAMBIGUOUS (skipped):");
  for (const a of ambiguous) console.log(`  ${a.raw}  ->  ${a.hits.join(" | ")}`);
}
if (unmatched.length) {
  console.log("\nUNMATCHED (skipped):");
  const counts = new Map();
  for (const p of placements) {
    if (unmatched.includes(p.person)) counts.set(p.person, (counts.get(p.person) ?? 0) + 1);
  }
  for (const n of unmatched) console.log(`  ${String(counts.get(n) ?? 0).padStart(4)}x  ${n}`);
}

fs.writeFileSync(
  path.join(ROOT, ".data/name_map.json"),
  JSON.stringify(
    Object.fromEntries([...matched].map(([k, v]) => [k, { id: v.id, full_name: v.full_name }])),
    null,
    2,
  ),
);
console.log("\nwrote .data/name_map.json");
