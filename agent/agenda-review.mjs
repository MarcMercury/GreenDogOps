// ezyVet Agenda review look-BACK worker — per location.
//
// The weekly look-ahead workers (agent/agenda-week.mjs) only pull FUTURE days,
// which captures what was BOOKED. To power the Appointment Review report we
// also need to re-pull recent PAST days so we can see what actually RENDERED
// (cancelled/moved appointments have dropped off the calendar). This worker
// pulls the previous N days once each morning, once per clinic (switching the
// ezyVet header first) so the Appointment Review report gets a post-day
// snapshot for every location. The ingest records a dated snapshot, and the
// report compares the booked snapshot (taken before the day) with this
// post-day snapshot.
//
// Env: EZYVET_USERNAME, EZYVET_PASSWORD, CRON_SECRET, APP_BASE_URL,
//      REVIEW_LOOKBACK_DAYS (default 14), RUN_ID (optional agent_run to update).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEzyvet } from "./ezyvet/session.mjs";
import { openReporting, runCsvReport, switchLocation } from "./ezyvet/report-center.mjs";
import { reportRun, ensureRun, uploadCsv } from "./lib/ingest.mjs";

const AGENT_KEY = "ezyvet_agenda_lookahead";
const LOOKBACK = Math.max(1, parseInt(process.env.REVIEW_LOOKBACK_DAYS ?? "14", 10) || 14);
let RUN_ID = process.env.RUN_ID || null;

// Clinics for the per-location review pull (switch the ezyVet header first).
const LOCATIONS = ["sherman_oaks", "van_nuys", "venice"];

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

// Enable the detailed report so Division(s) + Client Name columns are present
// (leave "Include cancelled appointments" off = the default, so a past-day
// pull reflects only appointments that still rendered).
async function enableDetailed(p) {
  const detailed = p.getByText("Show detailed report", { exact: false }).first();
  if (await detailed.count()) await detailed.click().catch(() => {});
  await p.waitForTimeout(400);
}

async function main() {
  if (!RUN_ID) RUN_ID = await ensureRun(AGENT_KEY, from, "scheduled");
  log(`review look-back: ${from} → ${to} run=${RUN_ID ?? "(none)"}`);
  await emit({ status: "running", logs: [{ message: `Agenda review (${from} → ${to})` }] });

  const dir = mkdtempSync(join(tmpdir(), "agenda-review-"));
  const session = await openEzyvet({ locationKey: "sherman_oaks", log });
  const detail = {};
  let totalCounted = 0;
  let totalCells = 0;
  let anySuccess = false;
  let anyFailure = false;

  for (const loc of LOCATIONS) {
    const slug = `review:${loc}`;
    const t0 = Date.now();
    try {
      await switchLocation(session.page, loc, log);
      await openReporting(session.page, log);
      const csvPath = join(dir, `agenda-review-${loc}-${from}.csv`);
      await runCsvReport(session.page, {
        name: "Agenda",
        fromIso: from,
        toIso: to,
        downloadPath: csvPath,
        log,
        configure: enableDetailed,
      });
      const result = await uploadCsv("ezyvet/agenda", csvPath, {
        location: loc,
        filename: `agenda-review-${loc}-${from}.csv`,
      });
      totalCounted += result.counted ?? 0;
      totalCells += result.inserted ?? 0;
      anySuccess = true;
      detail[slug] = { status: "success", from, to, ...result, ms: Date.now() - t0 };
      await emit({
        recordsProcessed: totalCounted,
        recordsNew: totalCells,
        detail: { ...detail },
        logs: [{ message: `Agenda review ${loc}: ${result.counted ?? 0} appts across ${result.inserted ?? 0} day/dept cells` }],
      });
      log(`${loc}: ${result.counted ?? 0} appts`);
    } catch (err) {
      anyFailure = true;
      const msg = err?.message ?? String(err);
      detail[slug] = { status: "error", from, to, error: msg, ms: Date.now() - t0 };
      await emit({
        detail: { ...detail },
        logs: [{ level: "error", message: `Agenda review ${loc} failed: ${msg}` }],
      });
      log(`ERROR ${loc}: ${msg}`);
    }
  }

  await session.close();

  const status = anyFailure && !anySuccess ? "error" : "success";
  await emit({
    status,
    detail: { ...detail },
    error: anyFailure && !anySuccess ? "All locations failed (see detail)." : undefined,
    logs: [{ message: `Agenda review finished: ${status} (${totalCounted} appts across ${totalCells} cells)` }],
  });
  log(`done: ${status} — ${totalCounted} appts`);
  process.exit(status === "error" ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  if (RUN_ID) await reportRun({ runId: RUN_ID, status: "error", error: err?.message ?? String(err) });
  process.exit(1);
});
