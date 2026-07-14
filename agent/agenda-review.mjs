// ezyVet Agenda review look-BACK worker.
//
// The weekly look-ahead workers (agent/agenda-week.mjs) only pull FUTURE days,
// which captures what was BOOKED. To power the Appointment Review report we
// also need to re-pull recent PAST days so we can see what actually RENDERED
// (cancelled/moved appointments have dropped off the calendar). This worker
// pulls the previous N days once each morning; the ingest records a dated
// snapshot, and the report compares the booked snapshot (taken before the day)
// with this post-day snapshot.
//
// Env: EZYVET_USERNAME, EZYVET_PASSWORD, CRON_SECRET, APP_BASE_URL,
//      REVIEW_LOOKBACK_DAYS (default 14), RUN_ID (optional agent_run to update).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEzyvet } from "./ezyvet/session.mjs";
import { openReporting, runCsvReport } from "./ezyvet/report-center.mjs";
import { reportRun, ensureRun, uploadCsv } from "./lib/ingest.mjs";

const AGENT_KEY = "ezyvet_agenda_lookahead";
const LOOKBACK = Math.max(1, parseInt(process.env.REVIEW_LOOKBACK_DAYS ?? "14", 10) || 14);
let RUN_ID = process.env.RUN_ID || null;

function isoLA(offsetDays = 0) {
  const la = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  la.setDate(la.getDate() + offsetDays);
  return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, "0")}-${String(la.getDate()).padStart(2, "0")}`;
}

const to = isoLA(-1); // yesterday (the day just completed)
const from = isoLA(-LOOKBACK);
const log = (m) => console.log(`[agenda-review] ${m}`);
async function emit(update) {
  if (RUN_ID) await reportRun({ runId: RUN_ID, ...update });
}

async function main() {
  if (!RUN_ID) RUN_ID = await ensureRun(AGENT_KEY, from, "scheduled");
  log(`review look-back: ${from} → ${to} run=${RUN_ID ?? "(none)"}`);
  await emit({ status: "running", logs: [{ message: `Agenda review (${from} → ${to})` }] });

  const dir = mkdtempSync(join(tmpdir(), "agenda-review-"));
  const session = await openEzyvet({ locationKey: "sherman_oaks", log });
  const t0 = Date.now();
  try {
    await openReporting(session.page, log);
    const csvPath = join(dir, `agenda-review-${from}.csv`);
    await runCsvReport(session.page, {
      name: "Agenda",
      fromIso: from,
      toIso: to,
      downloadPath: csvPath,
      log,
      configure: async (p) => {
        // Enable the detailed report so Division(s) + Client Name columns are
        // present (leave "Include cancelled appointments" off = the default, so
        // a past-day pull reflects only appointments that still rendered).
        const detailed = p.getByText("Show detailed report", { exact: false }).first();
        if (await detailed.count()) await detailed.click().catch(() => {});
        await p.waitForTimeout(400);
      },
    });
    const result = await uploadCsv("ezyvet/agenda", csvPath, { filename: `agenda-review-${from}.csv` });
    await emit({
      status: "success",
      recordsProcessed: result.parsed ?? 0,
      recordsNew: result.inserted ?? 0,
      detail: { review: { status: "success", from, to, ...result, ms: Date.now() - t0 } },
      logs: [{ message: `Agenda review: ${result.counted ?? 0} appts across ${result.inserted ?? 0} day/dept cells` }],
    });
    log(`done: ${result.counted ?? 0} appts`);
  } catch (err) {
    const msg = err?.message ?? String(err);
    await emit({
      status: "error",
      error: msg,
      detail: { review: { status: "error", from, to, error: msg, ms: Date.now() - t0 } },
      logs: [{ level: "error", message: `Agenda review failed: ${msg}` }],
    });
    log(`ERROR: ${msg}`);
    await session.close();
    process.exit(1);
  }
  await session.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  if (RUN_ID) await reportRun({ runId: RUN_ID, status: "error", error: err?.message ?? String(err) });
  process.exit(1);
});
