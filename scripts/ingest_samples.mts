// Ingest every sampled ezyVet CSV through the real generic ingest, against the
// real database. Verifies the specs, the tables and the upsert/rebuild logic
// before the worker ever runs.
//
//   NODE_PATH=/tmp/stub/node_modules npx --yes tsx@4 scripts/ingest_samples.mts [key ...]
import { existsSync, readFileSync } from "node:fs";

// dotenv is not installed — read .env.local by hand.
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { ingestReportCsvText } = await import("@/lib/reporting/generic-ingest");
const { REPORT_SPECS } = await import("@/lib/reporting/report-specs");

const only = process.argv.slice(2);
const keys = (only.length ? only : Object.keys(REPORT_SPECS)).filter((k) =>
  existsSync(`.secrets/ezyvet-probe/csv/${k}.csv`),
);

const target = process.env.TARGET_DATE ?? "2026-09-09";
let failed = 0;
for (const key of keys) {
  const text = readFileSync(`.secrets/ezyvet-probe/csv/${key}.csv`, "utf8");
  const result = await ingestReportCsvText(key, text, { from: target, to: target });
  if (!result.ok) failed++;
  console.log(
    `${result.ok ? "ok  " : "FAIL"} ${key.padEnd(30)} parsed=${result.parsed} inserted=${result.inserted}` +
      ` skipped=${result.skipped}${result.error ? ` error=${result.error}` : ""}`,
  );
}
console.log(failed ? `\n${failed} failed` : "\nall ingested");
