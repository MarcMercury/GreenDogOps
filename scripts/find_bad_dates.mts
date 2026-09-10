import { parseReportCsv } from "@/lib/reporting/generic-ingest";
import { REPORT_SPECS } from "@/lib/reporting/report-specs";
import { readFileSync } from "node:fs";

const key = process.argv[2] ?? "estimate_status";
const { rows } = parseReportCsv(
  readFileSync(`.secrets/ezyvet-probe/csv/${key}.csv`, "utf8"),
  REPORT_SPECS[key],
);
const valid = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
for (const col of Object.keys(rows[0] ?? {})) {
  const bad = rows.filter((r) => {
    const v = r[col];
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !valid.test(v);
  });
  if (bad.length) {
    console.log(`${col}: ${bad.length} invalid`);
    bad.slice(0, 5).forEach((r) => console.log("   ", JSON.stringify(r).slice(0, 220)));
  }
}
console.log("done");
