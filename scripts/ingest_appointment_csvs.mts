// Ingest appointment CSVs saved by agent/appointment-records.mjs (OUT_DIR)
// straight into the database, bypassing the HTTP sink. Used for the one-off
// 2026 backfill, and any time the export has already been downloaded.
//
// The from/to window is read from each filename
// ("appointments-<from>_<to>.csv") so the ingest rebuilds exactly the days the
// export covered.
//
//   NODE_PATH=/tmp/stub/node_modules npx --yes tsx@4 scripts/ingest_appointment_csvs.mts <dir>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// dotenv is not installed — read .env.local by hand.
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { ingestReportCsvText } = await import("@/lib/reporting/generic-ingest");

const dir = process.argv[2];
if (!dir) {
  console.error("usage: ingest_appointment_csvs.mts <dir>");
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith(".csv")).sort();
let failed = 0;
for (const file of files) {
  const m = file.match(/(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.csv$/);
  if (!m) {
    console.log(`skip ${file} (no date window in the name)`);
    continue;
  }
  const [, from, to] = m;
  const text = readFileSync(join(dir, file), "utf8");
  const result = await ingestReportCsvText("appointment_records", text, { from, to, filename: file });
  if (!result.ok) failed++;
  console.log(
    `${result.ok ? "ok  " : "FAIL"} ${from}..${to} parsed=${result.parsed} inserted=${result.inserted}` +
      ` skipped=${result.skipped}${result.error ? ` error=${result.error}` : ""}`,
  );
}
console.log(failed ? `\n${failed} failed` : `\nall ${files.length} windows ingested`);
