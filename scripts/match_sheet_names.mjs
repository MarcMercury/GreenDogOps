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

/**
 * Sheet spelling -> roster spelling, for cases token matching cannot bridge.
 * Only nicknames and spelling variants that resolve to exactly ONE roster
 * person with the SAME surname belong here. Anything where the surname differs
 * (e.g. sheet "Lizbeth Martinez" vs roster "Lizbeth Gallegos"/"Lizbeth Ramos")
 * is deliberately left out — that needs a human to confirm.
 */
const ALIASES = {
  "Tay Fox": "Taylor Fox",
  "Vero Rios": "Veronica Rios",
  "Rachel Banyasz": "Rachael Banyasz",
  "Rachel Banyasz1": "Rachael Banyasz",
};

/** Lowercase alphabetic tokens; drops honorifics and trailing dedupe digits. */
function tokens(name) {
  return String(ALIASES[String(name).trim()] ?? name)
    .replace(/\d+\s*$/, "")
    .toLowerCase()
    .replace(/\bdr\.?\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const rosterTokens = roster.map((p) => ({
  id: p.id,
  full_name: p.full_name,
  toks: tokens(p.full_name),
}));

const sheetNames = [...new Set(placements.map((p) => p.person))].sort();

const matched = new Map();
const ambiguous = [];
const unmatched = [];

for (const raw of sheetNames) {
  const t = tokens(raw);
  if (!t.length) continue;

  // 1. exact token-set equality
  let hits = rosterTokens.filter(
    (r) => r.toks.length === t.length && r.toks.every((x, i) => x === t[i]),
  );

  // 2. sheet tokens are a subset of the roster name ("Dr. Rally" in
  //    "Heather Rally Webb"); requires a surname-length token to avoid
  //    matching on a bare first name.
  if (hits.length !== 1) {
    const sub = rosterTokens.filter((r) => t.every((x) => r.toks.includes(x)));
    if (sub.length) hits = sub;
  }

  // 3. first + last initial ("Raquel Velez" vs "Raquel V Velez")
  if (hits.length !== 1 && t.length >= 2) {
    const fl = rosterTokens.filter(
      (r) => r.toks[0] === t[0] && r.toks.at(-1) === t.at(-1),
    );
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
