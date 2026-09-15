// ezyVet APPOINTMENT RECORDS worker — detailed appointment ingest.
//
// Drives the Records dashboard (Dashboard ▸ Records ▸ Record Type
// "Appointment") rather than the Report Center, because only that path exports
// one row per appointment WITH its type, pet and owner. Each window is queued
// as an Agenda CSV, downloaded from the Report Queue and POSTed to the generic
// sink /api/agents/ezyvet/report/appointment_records, which rebuilds exactly
// the days it covers.
//
// ezyVet refuses to export more than 10,000 records at once, so the requested
// range is sliced into windows (2 calendar months by default — comfortably
// under the cap at current volumes).
//
// Env: EZYVET_USERNAME, EZYVET_PASSWORD, CRON_SECRET, APP_BASE_URL,
//      RUN_ID (optional), FROM_DATE / TO_DATE (YYYY-MM-DD; default = LOOKBACK_DAYS
//      back through LOOKAHEAD_DAYS forward), WINDOW_MONTHS (default 2),
//      OUT_DIR (optional: keep the downloaded CSVs here instead of a temp dir —
//      a long backfill can then be re-ingested without re-exporting).
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEzyvet } from "./ezyvet/session.mjs";
import { switchDepartment, ROOT_DEPARTMENT } from "./ezyvet/report-center.mjs";
import { runAppointmentWindow, monthWindows } from "./ezyvet/appointments-export.mjs";
import { reportRun, ensureRun, uploadCsv } from "./lib/ingest.mjs";

const AGENT_KEY = process.env.AGENT_KEY || "ezyvet_extra_reports";
const REPORT_KEY = "appointment_records";
const WINDOW_MONTHS = Math.max(1, parseInt(process.env.WINDOW_MONTHS ?? "2", 10) || 2);
// Re-read a little history (late bookings, reschedules) and a long way forward,
// because most of what changes day to day is appointments booked into the
// future — a same-day-only pull would never see them.
const LOOKBACK_DAYS = Math.max(0, parseInt(process.env.LOOKBACK_DAYS ?? "7", 10));
const LOOKAHEAD_DAYS = Math.max(0, parseInt(process.env.LOOKAHEAD_DAYS ?? "120", 10));
let RUN_ID = process.env.RUN_ID || null;

function isoLA(offsetDays = 0) {
  const la = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  la.setDate(la.getDate() + offsetDays);
  return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, "0")}-${String(la.getDate()).padStart(2, "0")}`;
}

const TO_DATE = process.env.TO_DATE || isoLA(LOOKAHEAD_DAYS);
const FROM_DATE = process.env.FROM_DATE || isoLA(-LOOKBACK_DAYS);

const log = (m) => console.log(`[appts] ${m}`);
async function emit(update) {
  if (RUN_ID) await reportRun({ runId: RUN_ID, ...update });
}

/** Split an inclusive window in half; returns null when it is already one day. */
function halveWindow({ from, to }) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!(b > a)) return null;
  const mid = new Date(a + Math.floor((b - a) / 2 / 86_400_000) * 86_400_000);
  const midIso = mid.toISOString().slice(0, 10);
  if (midIso === to) return null;
  const next = new Date(mid.getTime() + 86_400_000).toISOString().slice(0, 10);
  return [{ from, to: midIso }, { from: next, to }];
}

async function main() {
  const queue = monthWindows(FROM_DATE, TO_DATE, WINDOW_MONTHS);
  const planned = queue.length;
  if (!RUN_ID) RUN_ID = await ensureRun(AGENT_KEY, TO_DATE, "scheduled");
  log(`${FROM_DATE} → ${TO_DATE} in ${planned} window(s) run=${RUN_ID ?? "(none)"}`);
  await emit({
    status: "running",
    logs: [{ message: `Appointment records ${FROM_DATE} → ${TO_DATE} (${planned} windows)` }],
  });

  const dir = process.env.OUT_DIR || mkdtempSync(join(tmpdir(), "ezyvet-appts-"));
  mkdirSync(dir, { recursive: true });
  const detail = {};
  let failures = 0;
  let done = 0;
  let session = null;

  // The record filter is department-scoped like the Contacts report, so the
  // whole run happens under the parent department to cover all hospitals.
  const openSession = async () => {
    session = await openEzyvet({ locationKey: "sherman_oaks", headless: true, blockAssets: true, log });
    await switchDepartment(session.page, ROOT_DEPARTMENT, log);
  };
  const closeSession = async () => {
    if (session) await session.browser.close().catch(() => {});
    session = null;
  };

  try {
    await openSession();

    while (queue.length) {
      const window = queue.shift();
      const { from, to } = window;
      const slug = `${from}_${to}`;
      try {
        if (!session) await openSession();
        const file = join(dir, `appointments-${slug}.csv`);
        const { path, count } = await runAppointmentWindow(session.page, {
          fromIso: from,
          toIso: to,
          downloadPath: file,
          log: (m) => log(`  ${slug}: ${m}`),
        });
        done++;
        if (!path) {
          detail[slug] = { status: "success", records: 0, note: "no appointments in window" };
          continue;
        }
        const result = await uploadCsv(`ezyvet/report/${REPORT_KEY}`, path, {
          from,
          to,
          filename: `appointments-${slug}.csv`,
        });
        detail[slug] = {
          status: "success",
          exported: count,
          parsed: result.parsed ?? 0,
          records: result.inserted ?? 0,
        };
        log(`${slug}: exported ${count}, ingested ${result.inserted ?? 0}`);
        await emit({
          recordsProcessed: result.parsed ?? 0,
          recordsIngested: result.inserted ?? 0,
          detail,
          logs: [{ message: `${slug}: ${result.inserted ?? 0} appointment rows` }],
        });
      } catch (err) {
        const message = err?.message ?? String(err);
        // Too many records for one export — retry the window in two halves.
        const halves = /export cap/.test(message) ? halveWindow(window) : null;
        if (halves) {
          log(`${slug}: over the export cap, splitting into ${halves.map((h) => `${h.from}..${h.to}`).join(" + ")}`);
          queue.unshift(...halves);
          continue;
        }
        failures++;
        done++;
        detail[slug] = { status: "error", error: message };
        log(`${slug}: ERROR ${message}`);
        await emit({ detail, logs: [{ level: "error", message: `${slug}: ${message}` }] });
        // A crashed renderer poisons every later window — start a fresh browser.
        if (/crash|closed|Target/i.test(message)) await closeSession();
      }
    }
  } finally {
    await closeSession();
  }

  await emit({
    status: failures && failures === done ? "error" : "success",
    detail,
    error: failures ? `${failures} of ${done} windows failed` : undefined,
    logs: [{ message: `Appointment records finished (${done - failures}/${done} ok)` }],
  });
  log(`done — ${done - failures}/${done} windows succeeded`);
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[appts] fatal:", err?.message ?? err);
  process.exit(1);
});
