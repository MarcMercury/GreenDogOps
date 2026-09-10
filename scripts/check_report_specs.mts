// Parse every sampled ezyVet CSV with its spec and print what came out.
// No database, no auth — pure parser check.
//
//   mkdir -p /tmp/stub/node_modules/server-only \
//     && echo '{"name":"server-only","main":"index.js"}' > /tmp/stub/node_modules/server-only/package.json \
//     && echo 'module.exports={}' > /tmp/stub/node_modules/server-only/index.js
//   NODE_PATH=/tmp/stub/node_modules npx --yes tsx@4 scripts/check_report_specs.mts [key ...]
import { existsSync, readFileSync } from "node:fs";
import { parseReportCsv } from "@/lib/reporting/generic-ingest";
import { REPORT_SPECS } from "@/lib/reporting/report-specs";

const only = process.argv.slice(2);
const keys = only.length ? only : Object.keys(REPORT_SPECS);

let failures = 0;
for (const key of keys) {
  const spec = REPORT_SPECS[key];
  const file = `.secrets/ezyvet-probe/csv/${key}.csv`;
  if (!spec) {
    console.log(`\n## ${key}: NO SPEC`);
    failures++;
    continue;
  }
  if (!existsSync(file)) {
    console.log(`\n## ${key}: no sample CSV`);
    continue;
  }
  const { rows, skipped, error } = parseReportCsv(readFileSync(file, "utf8"), spec);
  if (error) {
    console.log(`\n## ${key}: PARSE ERROR ${error}`);
    failures++;
    continue;
  }
  const declared = new Set([
    ...spec.columns.map((c) => c.column),
    ...(spec.buckets?.columns ?? []),
    ...(spec.sectionColumn ? [spec.sectionColumn] : []),
    ...(spec.locationFrom ? ["location_key"] : []),
  ]);
  const first = rows[0] ?? {};
  const allNull = [...declared].filter((c) => rows.length > 0 && rows.every((r) => r[c] == null));

  console.log(`\n## ${key} -> ${spec.table}: ${rows.length} rows, ${skipped} skipped`);
  console.log(`   sample: ${JSON.stringify(first).slice(0, 400)}`);
  if (allNull.length) {
    console.log(`   ⚠ ALWAYS NULL: ${allNull.join(", ")}`);
    failures++;
  }
}
console.log(`\n${failures ? `${failures} problem(s)` : "all specs OK"}`);
