// ezyVet Agenda look-ahead worker — ONE week per run, per location.
//
// The Agenda pull is split into four weekly runs (fired 10 minutes apart from
// 5 AM PT) so the Schedule always has the next 4 weeks of appointment demand
// loaded without a single heavy 28-day pull. Within each run we pull the 7-day
// window once per clinic (switching the ezyVet header first, exactly like the
// daily referral agent) so the Admin ▸ Agents audit shows the Agenda report
// running for each location. The ingest rebuilds only that clinic's window, so
// the per-location uploads accumulate instead of overwriting each other.
//
// Env: EZYVET_USERNAME, EZYVET_PASSWORD, CRON_SECRET, APP_BASE_URL,
//      WEEK_OFFSET (0..3, default 0), RUN_ID (optional agent_run to update).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEzyvet } from "./ezyvet/session.mjs";
import { openReporting, runCsvReport, switchLocation } from "./ezyvet/report-center.mjs";
import { reportRun, ensureRun, uploadCsv } from "./lib/ingest.mjs";

const AGENT_KEY = "ezyvet_agenda_lookahead";
const WEEK_OFFSET = Math.max(0, parseInt(process.env.WEEK_OFFSET ?? "0", 10) || 0);
let RUN_ID = process.env.RUN_ID || null;

// Clinics for the per-location Agenda pull (switch the ezyVet header first).
const LOCATIONS = ["sherman_oaks", "van_nuys", "venice"];

function isoLA(offsetDays = 0) {
  const la = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  la.setDate(la.getDate() + offsetDays);
  return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, "0")}-${String(la.getDate()).padStart(2, "0")}`;
}

const from = isoLA(WEEK_OFFSET * 7);
const to = isoLA(WEEK_OFFSET * 7 + 6);
const log = (m) => console.log(`[agenda] ${m}`);
async function emit(update) {
  if (RUN_ID) await reportRun({ runId: RUN_ID, ...update });
}

// Enable the detailed report so Division(s) + Client Name columns are present
// (leave "Include cancelled appointments" off = the default).
async function enableDetailed(p) {
  const detailed = p.getByText("Show detailed report", { exact: false }).first();
  if (await detailed.count()) await detailed.click().catch(() => {});
  await p.waitForTimeout(400);
}

async function main() {
  if (!RUN_ID) RUN_ID = await ensureRun(AGENT_KEY, from, "scheduled");
  log(`week ${WEEK_OFFSET}: ${from} → ${to} run=${RUN_ID ?? "(none)"}`);
  await emit({ status: "running", logs: [{ message: `Agenda week ${WEEK_OFFSET} (${from} → ${to})` }] });

  const dir = mkdtempSync(join(tmpdir(), "agenda-"));
  const session = await openEzyvet({ locationKey: "sherman_oaks", log });
  const detail = {};
  let totalCounted = 0;
  let totalCells = 0;
  let anySuccess = false;
  let anyFailure = false;

  for (const loc of LOCATIONS) {
    const slug = `week_${WEEK_OFFSET}:${loc}`;
    const t0 = Date.now();
    try {
      await switchLocation(session.page, loc, log);
      await openReporting(session.page, log);
      const csvPath = join(dir, `agenda-${loc}-${from}.csv`);
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
        filename: `agenda-${loc}-${from}.csv`,
      });
      totalCounted += result.counted ?? 0;
      totalCells += result.inserted ?? 0;
      anySuccess = true;
      detail[slug] = { status: "success", from, to, ...result, ms: Date.now() - t0 };
      await emit({
        recordsProcessed: totalCounted,
        recordsNew: totalCells,
        detail: { ...detail },
        logs: [{ message: `Agenda week ${WEEK_OFFSET} ${loc}: ${result.counted ?? 0} appts across ${result.inserted ?? 0} day/dept cells` }],
      });
      log(`${loc}: ${result.counted ?? 0} appts`);
    } catch (err) {
      anyFailure = true;
      const msg = err?.message ?? String(err);
      detail[slug] = { status: "error", from, to, error: msg, ms: Date.now() - t0 };
      await emit({
        detail: { ...detail },
        logs: [{ level: "error", message: `Agenda week ${WEEK_OFFSET} ${loc} failed: ${msg}` }],
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
    logs: [{ message: `Agenda week ${WEEK_OFFSET} finished: ${status} (${totalCounted} appts across ${totalCells} cells)` }],
  });
  log(`done: ${status} — ${totalCounted} appts`);
  process.exit(status === "error" ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  if (RUN_ID) await reportRun({ runId: RUN_ID, status: "error", error: err?.message ?? String(err) });
  process.exit(1);
});
