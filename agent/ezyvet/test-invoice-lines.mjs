// Live test: download the Invoice Lines report CSV for a date range.
// Usage: node agent/ezyvet/test-invoice-lines.mjs 2026-07-13 2026-07-13
import { openEzyvet } from "./session.mjs";
import { runCsvReport, openReporting } from "./report-center.mjs";
import { mkdirSync } from "node:fs";

const from = process.argv[2] || "2026-07-13";
const to = process.argv[3] || from;
mkdirSync(".secrets/ezyvet-downloads", { recursive: true });
const out = `.secrets/ezyvet-downloads/invoice-lines-${from}.csv`;
const log = (m) => console.log(`[worker] ${m}`);

const session = await openEzyvet({ locationKey: "sherman_oaks", log });
try {
  await openReporting(session.page, log);
  const file = await runCsvReport(session.page, {
    name: "Invoice Lines",
    fromIso: from,
    toIso: to,
    downloadPath: out,
    log,
  });
  const { statSync, readFileSync } = await import("node:fs");
  const size = statSync(file).size;
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  console.log(`\nDONE: ${file} (${size} bytes, ${lines.length - 1} data rows)`);
  console.log("header:\n" + lines[0].slice(0, 300));
  // "Invoice Line Date" is the 11th column (index 10). Sample the span.
  const dates = lines.slice(1).map((l) => {
    const cells = l.split(",");
    return (cells[10] || "").replace(/"/g, "");
  }).filter((d) => /\d/.test(d));
  if (dates.length) {
    const sorted = [...new Set(dates)].sort();
    console.log(`Invoice Line Date span: ${sorted[0]} .. ${sorted[sorted.length - 1]} (${sorted.length} distinct days)`);
  }
} catch (err) {
  console.log("TEST ERROR:", err?.message ?? String(err));
  await session.page.screenshot({ path: ".secrets/ezyvet-probe/50-invoice-error.png", fullPage: true }).catch(() => {});
} finally {
  await session.close();
}
