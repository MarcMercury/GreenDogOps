// ezyVet Agenda look-ahead worker — ONE week per run.
//
// The Agenda pull is split into four weekly runs (fired 10 minutes apart from
// 5 AM PT) so the Schedule always has the next 4 weeks of appointment demand
// loaded without a single heavy 28-day pull. Each run pulls a 7-day window and
// the ingest rebuilds only that window, so the four weeks accumulate.
//
// Env: EZYVET_USERNAME, EZYVET_PASSWORD, CRON_SECRET, APP_BASE_URL,
//      WEEK_OFFSET (0..3, default 0), RUN_ID (optional agent_run to update).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEzyvet } from "./session.mjs";
import { openReporting, runCsvReport } from "./report-center.mjs";
import { reportRun, ensureRun, uploadCsv } from "../lib/ingest.mjs";

const AGENT_KEY = "ezyvet_agenda_lookahead";
const WEEK_OFFSET = Math.max(0, parseInt(process.env.WEEK_OFFSET ?? "0", 10) || 0);
let RUN_ID = process.env.RUN_ID || null;

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

async function main() {
  if (!RUN_ID) RUN_ID = await ensureRun(AGENT_KEY, from, "scheduled");
  log(`week ${WEEK_OFFSET}: ${from} → ${to} run=${RUN_ID ?? "(none)"}`);
  await emit({ status: "running", logs: [{ message: `Agenda week ${WEEK_OFFSET} (${from} → ${to})` }] });

  const dir = mkdtempSync(join(tmpdir(), "agenda-"));
  const session = await openEzyvet({ locationKey: "sherman_oaks", log });
  const t0 = Date.now();
  try {
    await openReporting(session.page, log);
    const csvPath = join(dir, `agenda-${from}.csv`);
    await runCsvReport(session.page, {
      name: "Agenda",
      fromIso: from,
      toIso: to,
      downloadPath: csvPath,
      log,
      configure: async (p) => {
        // Enable the detailed report so Division(s) + Client Name columns are
        // present (leave "Include cancelled appointments" off = the default).
        const detailed = p.getByText("Show detailed report", { exact: false }).first();
        if (await detailed.count()) await detailed.click().catch(() => {});
        await p.waitForTimeout(400);
      },
    });
    const result = await uploadCsv("ezyvet/agenda", csvPath, { filename: `agenda-${from}.csv` });
    await emit({
      status: "success",
      recordsProcessed: result.parsed ?? 0,
      recordsNew: result.inserted ?? 0,
      detail: { [`week_${WEEK_OFFSET}`]: { status: "success", from, to, ...result, ms: Date.now() - t0 } },
      logs: [{ message: `Agenda week ${WEEK_OFFSET}: ${result.counted ?? 0} appts across ${result.inserted ?? 0} day/dept cells` }],
    });
    log(`done: ${result.counted ?? 0} appts`);
  } catch (err) {
    const msg = err?.message ?? String(err);
    await emit({
      status: "error",
      error: msg,
      detail: { [`week_${WEEK_OFFSET}`]: { status: "error", from, to, error: msg, ms: Date.now() - t0 } },
      logs: [{ level: "error", message: `Agenda week ${WEEK_OFFSET} failed: ${msg}` }],
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
