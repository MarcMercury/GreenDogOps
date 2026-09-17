/**
 * Load manually exported ezyVet tag membership files.
 *
 * Each file is a Contacts (or Pets) export filtered to ONE tag in ezyVet, so
 * the tag is carried by the filename, not by any column. Files go through the
 * same merge path as the nightly agent (greendogops.merge_record_tag), as a
 * BACKFILL — these exports are a tag's whole population, which is exactly what
 * gives the tag the baseline an incremental run needs.
 *
 * Usage:
 *   npx tsx scripts/import_record_tags.mts "public/AP tag.csv#ap=ap" ...
 *   npx tsx scripts/import_record_tags.mts --dir public   (infer tags from names)
 *
 * Each argument is <file>[#<tag_key>=<Tag Label>]. Without the suffix the tag
 * key and label are derived from the filename, which is only a guess — pass the
 * suffix whenever the ezyVet tag is spelled differently from the file.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const { ingestRecordTagCsv } = await import("../src/lib/reporting/record-tags");

/** "101 coded clients.csv" -> { key: "code_101", label: "CODE *101*" }. */
function inferTag(file: string): { key: string; label: string } {
  const stem = basename(file).replace(/\.csv$/i, "").trim();
  // "<n> coded clients" is how the promo codes are exported.
  const coded = stem.match(/^(\d+)\s+coded/i);
  if (coded) return { key: `code_${coded[1]}`, label: `CODE *${coded[1]}*` };
  const label = stem.replace(/\s+tags?$/i, "").trim();
  return { key: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), label };
}

function parseArg(arg: string): { file: string; key: string; label: string } {
  const [file, spec] = arg.split("#");
  if (!spec) return { file, ...inferTag(file) };
  const at = spec.indexOf("=");
  if (at < 0) throw new Error(`"${arg}": expected <file>#<tag_key>=<Tag Label>`);
  return { file, key: spec.slice(0, at), label: spec.slice(at + 1) };
}

const args = process.argv.slice(2);
const dirAt = args.indexOf("--dir");
const files =
  dirAt >= 0
    ? readdirSync(args[dirAt + 1])
        .filter((f) => /\.csv$/i.test(f))
        .map((f) => join(args[dirAt + 1], f))
    : args;

if (!files.length) {
  console.error("Usage: import_record_tags.mts <file>[#key=Label] ... | --dir <folder>");
  process.exit(2);
}

const runOn = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }))
  .toISOString()
  .slice(0, 10);

let failed = 0;
for (const arg of files) {
  const { file, key, label } = parseArg(arg);
  const result = await ingestRecordTagCsv(readFileSync(file, "utf8"), {
    tagKey: key,
    tagLabel: label,
    tagType: "contact_tag",
    tagGroup: "General",
    recordType: "contact",
    mode: "backfill",
    runOn,
  });
  if (!result.ok) {
    failed++;
    console.error(`✗ ${basename(file)} (${label}): ${result.error}`);
    continue;
  }
  console.log(
    `✓ ${basename(file)} -> ${key} "${label}": ${result.matched} matched, ` +
      `${result.added} added, ${result.confirmed} confirmed, ${result.removed} removed` +
      (result.skipped ? `, ${result.skipped} duplicate/blank rows skipped` : ""),
  );
}
if (failed) process.exitCode = 1;
