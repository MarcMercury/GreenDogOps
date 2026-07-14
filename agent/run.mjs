// ezyVet daily ingest worker — orchestrator.
//
// Invoked by GitHub Actions (scheduled 5AM or workflow_dispatch). Logs into
// ezyVet, runs each enabled report for the target day, uploads the CSVs to the
// app's data sinks, and reports progress/records back to /api/agents/ingest.
//
// Env: EZYVET_USERNAME, EZYVET_PASSWORD, CRON_SECRET, APP_BASE_URL,
//      RUN_ID (agent_run id to update), TARGET_DATE (YYYY-MM-DD, optional),
//      AGENT_KEY (optional, informational).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEzyvet } from "./ezyvet/session.mjs";
import { openReporting, runCsvReport, switchLocation } from "./ezyvet/report-center.mjs";
import { reportRun, ensureRun, refreshReporting } from "./lib/ingest.mjs";

let RUN_ID = process.env.RUN_ID || null;
const AGENT_KEY = process.env.AGENT_KEY || "ezyvet_daily_ingest";

function previousDayLA() {
  const la = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  la.setDate(la.getDate() - 1);
  return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, "0")}-${String(la.getDate()).padStart(2, "0")}`;
}
const TARGET_DATE = process.env.TARGET_DATE || previousDayLA();

// Clinics for per-location reports (must switch the ezyVet header first).
const LOCATIONS = ["sherman_oaks", "van_nuys", "venice"];

// Global reports (one run for the whole business). `dated` → From/To = TARGET_DATE.
const GLOBAL_REPORTS = [
  { key: "invoice_lines", name: "Invoice Lines", dated: true, endpoint: "ezyvet/invoice-lines" },
  { key: "ezyvet_crm_contacts", name: "Contacts", dated: false, endpoint: "ezyvet/contacts" },
  { key: "referral_statistics", name: "Referral Statistics", dated: false, endpoint: "ezyvet/referral" },
];

// Per-location reports (run once per clinic; the referral ingest auto-detects
// the report type and updates the matched referral partners' fields).
const PER_LOCATION_REPORTS = [
  { key: "referral_revenue", name: "Referrer Revenue", dated: true, endpoint: "ezyvet/referral" },
];

const log = (m) => console.log(`[worker] ${m}`);
async function emit(update) {
  if (RUN_ID) await reportRun({ runId: RUN_ID, ...update });
}

async function main() {
  // Scheduled (GitHub cron) runs have no RUN_ID from the app — create one.
  if (!RUN_ID) {
    RUN_ID = await ensureRun(AGENT_KEY, TARGET_DATE, "scheduled");
  }
  log(`agent=${AGENT_KEY} target=${TARGET_DATE} run=${RUN_ID ?? "(none)"}`);
  await emit({ status: "running", logs: [{ message: `Worker started for ${TARGET_DATE}` }] });

  const dir = mkdtempSync(join(tmpdir(), "ezyvet-"));
  const { uploadCsv } = await import("./lib/ingest.mjs");
  const session = await openEzyvet({ locationKey: "sherman_oaks", log });
  const detail = {};
  let anySuccess = false;
  let anyFailure = false;

  // Run one report and upload its CSV. `slug` disambiguates per-location runs.
  async function runOne(report, { slug = report.key, locationLabel } = {}) {
    const t0 = Date.now();
    const label = locationLabel ? `${report.name} (${locationLabel})` : report.name;
    try {
      await emit({ logs: [{ message: `Running ${label}…` }] });
      // Re-open the Report Center each time so prior report tabs/filters don't
      // leave the catalog in a state where the next report can't be found.
      await openReporting(session.page, log);
      const csvPath = join(dir, `${slug}-${TARGET_DATE}.csv`);
      await runCsvReport(session.page, {
        name: report.name,
        fromIso: report.dated ? TARGET_DATE : undefined,
        toIso: report.dated ? TARGET_DATE : undefined,
        downloadPath: csvPath,
        log,
      });

      const query = report.dated
        ? { label: `Agent ${TARGET_DATE}`, filename: `${slug}-${TARGET_DATE}.csv` }
        : { snapshot_date: TARGET_DATE, filename: `${slug}-${TARGET_DATE}.csv` };
      const result = await uploadCsv(report.endpoint, csvPath, query);

      const records = (result.inserted ?? 0) + (result.updated ?? 0);
      detail[slug] = { status: "success", ...result, ms: Date.now() - t0 };
      anySuccess = true;
      await emit({
        recordsProcessed: result.parsed ?? 0,
        recordsNew: result.inserted ?? 0,
        detail: { ...detail },
        logs: [{ message: `${label}: ${result.parsed ?? 0} parsed, ${records} new/updated` }],
      });
    } catch (err) {
      anyFailure = true;
      const msg = err?.message ?? String(err);
      detail[slug] = { status: "error", error: msg, ms: Date.now() - t0 };
      await emit({ detail: { ...detail }, logs: [{ level: "error", message: `${label} failed: ${msg}` }] });
      log(`ERROR ${label}: ${msg}`);
    }
  }

  try {
    await openReporting(session.page, log);

    // 1) Global reports.
    for (const report of GLOBAL_REPORTS) {
      await runOne(report);
    }

    // 2) Per-location reports: switch the clinic, then run.
    for (const report of PER_LOCATION_REPORTS) {
      for (const loc of LOCATIONS) {
        try {
          await switchLocation(session.page, loc, log);
          await openReporting(session.page, log);
        } catch (err) {
          anyFailure = true;
          const msg = err?.message ?? String(err);
          detail[`${report.key}:${loc}`] = { status: "error", error: `location switch: ${msg}` };
          await emit({ detail: { ...detail }, logs: [{ level: "error", message: `${loc} switch failed: ${msg}` }] });
          continue;
        }
        await runOne(report, { slug: `${report.key}:${loc}`, locationLabel: loc });
      }
    }
  } catch (err) {
    anyFailure = true;
    await emit({ logs: [{ level: "error", message: `Fatal: ${err?.message ?? err}` }] });
  } finally {
    await session.close();
  }

  // 3) Rebuild the reporting roll-ups once, after all uploads (isolated + retried).
  if (detail["invoice_lines"]?.status === "success") {
    const t0 = Date.now();
    try {
      await emit({ logs: [{ message: "Refreshing reporting roll-ups…" }] });
      const r = await refreshReporting();
      detail.reporting_refresh = { status: "success", ms: r?.ms ?? Date.now() - t0 };
      await emit({ detail: { ...detail }, logs: [{ message: `Reporting refresh done (${r?.ms ?? "?"}ms)` }] });
    } catch (err) {
      anyFailure = true;
      const msg = err?.message ?? String(err);
      detail.reporting_refresh = { status: "error", error: msg, ms: Date.now() - t0 };
      await emit({ detail: { ...detail }, logs: [{ level: "error", message: `Reporting refresh failed: ${msg}` }] });
    }
  }

  const status = anyFailure && !anySuccess ? "error" : "success";
  await emit({
    status,
    detail: { ...detail },
    error: anyFailure ? "One or more reports failed (see detail)." : undefined,
    logs: [{ message: `Worker finished: ${status}` }],
  });
  log(`done: ${status}`);
  process.exit(status === "error" ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  if (RUN_ID) await reportRun({ runId: RUN_ID, status: "error", error: err?.message ?? String(err) });
  process.exit(1);
});
