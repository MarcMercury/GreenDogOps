// ezyVet EXTRA REPORTS worker — the spec-driven half of the daily ingest.
//
// Runs every report in agent/ezyvet/report-catalog.mjs (payments, receivables,
// appointments, clinical, inventory) and POSTs each CSV to the generic sink at
// /api/agents/ezyvet/report/<key>. Kept separate from run.mjs so a failure in
// the long tail can never jeopardise the core invoice/patient ingest, and so
// the two can be scheduled apart.
//
// Env: EZYVET_USERNAME, EZYVET_PASSWORD, CRON_SECRET, APP_BASE_URL,
//      RUN_ID (optional), TARGET_DATE (YYYY-MM-DD, default previous LA day),
//      REPORT_KEYS (optional comma list to run a subset).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEzyvet } from "./ezyvet/session.mjs";
import { openReporting, runCsvReport, switchDepartment, ROOT_DEPARTMENT } from "./ezyvet/report-center.mjs";
import { EXTRA_REPORTS, applyReportForm, shiftIso } from "./ezyvet/report-catalog.mjs";
import { reportRun, ensureRun, uploadCsv } from "./lib/ingest.mjs";

const AGENT_KEY = process.env.AGENT_KEY || "ezyvet_extra_reports";
let RUN_ID = process.env.RUN_ID || null;

function previousDayLA() {
  const la = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  la.setDate(la.getDate() - 1);
  return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, "0")}-${String(la.getDate()).padStart(2, "0")}`;
}
const TARGET_DATE = process.env.TARGET_DATE || previousDayLA();

const only = (process.env.REPORT_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
const REPORTS = only.length ? EXTRA_REPORTS.filter((r) => only.includes(r.key)) : EXTRA_REPORTS;

const log = (m) => console.log(`[extra] ${m}`);
async function emit(update) {
  if (RUN_ID) await reportRun({ runId: RUN_ID, ...update });
}

async function runOne(page, report, dir) {
  const from = shiftIso(TARGET_DATE, -(report.window ?? 0));
  const useRange = report.dates === "range";
  const file = join(dir, `${report.key}.csv`);

  await openReporting(page, () => {});
  await runCsvReport(page, {
    name: report.name,
    fromIso: useRange ? from : undefined,
    toIso: useRange ? TARGET_DATE : undefined,
    downloadPath: file,
    configure: (p) => applyReportForm(p, report, TARGET_DATE),
    log: (m) => log(`  ${report.key}: ${m}`),
  });

  return uploadCsv(`ezyvet/report/${report.key}`, file, {
    from,
    to: TARGET_DATE,
    filename: `${report.key}.csv`,
  });
}

async function main() {
  if (!RUN_ID) RUN_ID = await ensureRun(AGENT_KEY, TARGET_DATE, "scheduled");
  log(`agent=${AGENT_KEY} target=${TARGET_DATE} reports=${REPORTS.length} run=${RUN_ID ?? "(none)"}`);
  await emit({ status: "running", logs: [{ message: `Extra reports started for ${TARGET_DATE}` }] });

  const dir = mkdtempSync(join(tmpdir(), "ezyvet-extra-"));
  const { browser, page } = await openEzyvet({ locationKey: "sherman_oaks", headless: true, log });

  const detail = {};
  let failures = 0;
  try {
    // Most of these reports only export the header department's records, so run
    // the whole set under the parent department to cover all three hospitals.
    await switchDepartment(page, ROOT_DEPARTMENT, log);

    for (const report of REPORTS) {
      try {
        const result = await runOne(page, report, dir);
        detail[report.key] = { status: "success", records: result.inserted ?? 0, parsed: result.parsed ?? 0 };
        log(`${report.key}: ${result.inserted ?? 0} rows`);
        await emit({
          recordsIngested: result.inserted ?? 0,
          detail,
          logs: [{ message: `${report.name}: ${result.inserted ?? 0} rows` }],
        });
      } catch (err) {
        failures++;
        const message = err?.message ?? String(err);
        detail[report.key] = { status: "error", error: message };
        log(`${report.key}: ERROR ${message}`);
        await emit({ detail, logs: [{ level: "error", message: `${report.name}: ${message}` }] });
      }
    }
  } finally {
    await browser.close();
  }

  const status = failures === 0 ? "success" : failures === REPORTS.length ? "error" : "success";
  await emit({
    status,
    detail,
    error: failures ? `${failures} of ${REPORTS.length} reports failed` : undefined,
    logs: [{ message: `Extra reports finished (${REPORTS.length - failures}/${REPORTS.length} ok)` }],
  });
  log(`done — ${REPORTS.length - failures}/${REPORTS.length} succeeded`);
}

main().catch(async (err) => {
  const message = err?.message ?? String(err);
  console.error("[extra] fatal:", message);
  await emit({ status: "error", error: message });
  process.exit(1);
});
