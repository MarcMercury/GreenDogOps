// Pull ONE real CSV per report in the extra-reports registry so the database
// schema can be built from the actual column layout. Read-only with respect to
// ezyVet data: it only generates report files in the Report Queue.
//
// Run: set -a; source .secrets/ezyvet.env; set +a; node agent/ezyvet/sample-reports.mjs [key ...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { openEzyvet } from "./session.mjs";
import { openReporting, runCsvReport, switchDepartment, ROOT_DEPARTMENT } from "./report-center.mjs";
import { EXTRA_REPORTS, applyReportForm, shiftIso } from "./report-catalog.mjs";

const OUT_DIR = ".secrets/ezyvet-probe/csv";
const SUMMARY = ".secrets/ezyvet-probe/csv-headers.json";
const TARGET = process.env.TARGET_DATE || shiftIso(new Date().toISOString().slice(0, 10), -1);
const DEPARTMENT = process.env.DEPARTMENT || ROOT_DEPARTMENT;

const only = process.argv.slice(2);
const wanted = only.length ? EXTRA_REPORTS.filter((r) => only.includes(r.key)) : EXTRA_REPORTS;

mkdirSync(OUT_DIR, { recursive: true });
const summary = existsSync(SUMMARY) ? JSON.parse(readFileSync(SUMMARY, "utf8")) : {};

const log = (m) => console.log(`[sample] ${m}`);

/** First `n` lines, quote-aware so embedded newlines don't split a record. */
function head(text, n) {
  const out = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length && out.length < n; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === "\n" && !inQuotes) {
      out.push(text.slice(start, i).replace(/\r$/, ""));
      start = i + 1;
    }
  }
  return out;
}

try {
  // Chromium in this dev container reliably crashes after a long ezyVet
  // session, so recycle the browser every few reports.
  const BATCH = Number(process.env.BATCH || 5);
  let session = null;
  let sinceRestart = 0;

  const openSession = async () => {
    // The dev-container Chromium crashes readily on ezyVet's heavy pages, and
    // the crash can land on the very first navigation — retry before giving up.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        session = await openEzyvet({ locationKey: "sherman_oaks", headless: true, blockAssets: true, log });
        await switchDepartment(session.page, DEPARTMENT, log);
        sinceRestart = 0;
        return;
      } catch (err) {
        log(`session attempt ${attempt} failed: ${err?.message ?? err}`);
        await closeSession();
      }
    }
    throw new Error("could not open an ezyVet session after 3 attempts");
  };
  const closeSession = async () => {
    if (session) await session.browser.close().catch(() => {});
    session = null;
  };

  for (const report of wanted) {
    const file = `${OUT_DIR}/${report.key}.csv`;
    const previous = summary[report.key];
    if (previous && !previous.error && existsSync(file) && !only.length) {
      log(`${report.key}: already sampled`);
      continue;
    }
    if (!session || sinceRestart >= BATCH) {
      await closeSession();
      try {
        await openSession();
      } catch (err) {
        summary[report.key] = { name: report.name, error: err?.message ?? String(err) };
        writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));
        continue;
      }
    }
    sinceRestart++;
    try {
      await openReporting(session.page, () => {});
      const window = { from: shiftIso(TARGET, -(report.window ?? 0)), to: TARGET };
      const useRange = report.dates === "range";
      await runCsvReport(session.page, {
        name: report.name,
        fromIso: useRange ? window.from : undefined,
        toIso: useRange ? window.to : undefined,
        downloadPath: file,
        configure: (p) => applyReportForm(p, report, TARGET),
        log: (m) => log(`  ${report.key}: ${m}`),
      });

      const text = readFileSync(file, "utf8");
      summary[report.key] = {
        name: report.name,
        bytes: text.length,
        lines: text.split("\n").length,
        preview: head(text, 12),
      };
      log(`${report.key}: ${text.length} bytes, ${summary[report.key].lines} lines`);
    } catch (err) {
      summary[report.key] = { name: report.name, error: err?.message ?? String(err) };
      log(`${report.key}: ERROR ${summary[report.key].error}`);
      // A crashed browser poisons every later report — force a fresh one.
      if (/crash|closed|Target/i.test(summary[report.key].error)) {
        await closeSession();
      }
    }
    writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));
  }
  await closeSession();
} finally {
  writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));
}
log(`wrote ${SUMMARY}`);
