// One-off: export a short appointment window via Dashboard ▸ Records and dump
// the CSV header + a few rows, so the ingest can be written against the real
// column names.
//
// Run: set -a; source .secrets/ezyvet.env; set +a; node agent/ezyvet/probe-appointments-csv.mjs [from] [to]
import { mkdirSync, readFileSync } from "node:fs";
import { openEzyvet } from "./session.mjs";
import { switchDepartment, ROOT_DEPARTMENT } from "./report-center.mjs";
import { runAppointmentWindow } from "./appointments-export.mjs";

const OUT = ".secrets/ezyvet-probe";
const from = process.argv[2] ?? "2026-09-01";
const to = process.argv[3] ?? "2026-09-02";
const log = (m) => console.log(`[appt-csv] ${m}`);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const session = await openEzyvet({ headless: true, blockAssets: true, log });
  try {
    await switchDepartment(session.page, ROOT_DEPARTMENT, log);
    const path = `${OUT}/appointments-${from}_${to}.csv`;
    const { path: saved, count } = await runAppointmentWindow(session.page, {
      fromIso: from,
      toIso: to,
      downloadPath: path,
      log,
    });
    log(`count=${count} path=${saved}`);
    if (!saved) return;
    const text = readFileSync(saved, "utf8");
    const lines = text.split("\n");
    log(`bytes=${text.length} lines=${lines.length}`);
    console.log("--- HEADER ---");
    console.log(lines[0]);
    console.log("--- ROWS ---");
    console.log(lines.slice(1, 4).join("\n"));
  } catch (err) {
    log(`ERROR: ${err?.message ?? err}`);
    await session.page.screenshot({ path: `${OUT}/appt-csv-error.png`, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await session.close();
  }
}

main();
