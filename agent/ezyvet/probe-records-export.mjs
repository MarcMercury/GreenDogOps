// Probe 3: ezyVet Dashboard ▸ Records ▸ Appointment — run Show Records for a
// short date window, then dump the "Perform Action" UI (Export Appointments →
// All → format chooser). Stops BEFORE the final Export unless RUN_EXPORT=1.
//
// Run: set -a; source .secrets/ezyvet.env; set +a; node agent/ezyvet/probe-records-export.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { openEzyvet } from "./session.mjs";
import { switchDepartment, ROOT_DEPARTMENT } from "./report-center.mjs";
import { openRecordsTab, setRecordType, setDateWindow, showRecords } from "./records-dashboard.mjs";

const OUT = ".secrets/ezyvet-probe";
const log = (m) => console.log(`[probe-export] ${m}`);

async function dumpVisible(page, tag) {
  const data = await page.evaluate(() => {
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight);
    return {
      testids: [...document.querySelectorAll("[data-testid]")]
        .filter(vis)
        .map((el) => `${el.getAttribute("data-testid")}|${el.tagName}|${(el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60)}`),
      selects: [...document.querySelectorAll("select")].filter(vis).map((s) => ({
        name: s.name,
        id: s.id,
        value: s.value,
        options: [...s.options].slice(0, 80).map((o) => `${o.value}::${o.text.trim()}`),
      })),
      radios: [...document.querySelectorAll("input[type=radio]")].filter(vis).map((r) => `${r.name}=${r.value} checked=${r.checked}`),
      buttons: [...document.querySelectorAll("a, button, span.aButton, div.innerButton, .clickable")]
        .filter(vis)
        .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
        .filter((t) => t && t.length < 60),
    };
  });
  writeFileSync(`${OUT}/export-${tag}.json`, JSON.stringify(data, null, 2));
  log(`${tag}: ${data.testids.length} testids, ${data.selects.length} selects`);
  return data;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const session = await openEzyvet({ headless: true, blockAssets: true, log });
  const { page } = session;
  try {
    await switchDepartment(page, ROOT_DEPARTMENT, log);
    await openRecordsTab(page, log);
    await setRecordType(page, "MetaAppointment", log);
    await setDateWindow(page, "2026-09-01", "2026-09-02", log);
    await page.screenshot({ path: `${OUT}/export-01-filters.png`, fullPage: true }).catch(() => {});

    const count = await showRecords(page, log);
    log(`record count: ${count}`);
    await page.screenshot({ path: `${OUT}/export-02-results.png`, fullPage: true }).catch(() => {});
    await dumpVisible(page, "02-results");
    writeFileSync(`${OUT}/export-results.txt`, await page.evaluate(() => document.body.innerText));

    // Open the Perform Action section.
    log("looking for Perform Action");
    const pa = page.getByText(/Perform Action/i).first();
    if (await pa.count()) {
      await pa.click().catch(() => {});
      await page.waitForTimeout(2500);
    }
    await page.screenshot({ path: `${OUT}/export-03-perform-action.png`, fullPage: true }).catch(() => {});
    await dumpVisible(page, "03-perform-action");
    writeFileSync(`${OUT}/export-perform-action.txt`, await page.evaluate(() => document.body.innerText));

    // Select All + Export - Appointments, click Action, and capture whatever
    // prompt appears (this is the step we need real selectors for).
    log("selecting All + ExportAppointments");
    await page.locator('input[name="ProcessOn"][value="All"]').first().check({ force: true });
    await page.waitForTimeout(800);
    await page.selectOption('select[name="actionToPerform"]', "ExportAppointments");
    await page.waitForTimeout(1500);

    const downloadPromise = page.waitForEvent("download", { timeout: 300_000 }).catch(() => null);
    await page.locator('[data-testid="Action"]').first().click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${OUT}/export-04-prompt.png`, fullPage: true }).catch(() => {});
    await dumpVisible(page, "04-prompt");
    writeFileSync(`${OUT}/export-prompt.txt`, await page.evaluate(() => document.body.innerText));
    writeFileSync(`${OUT}/export-prompt.html`, await page.content());

    const dl = await downloadPromise;
    if (dl) {
      await dl.saveAs(`${OUT}/export-sample.csv`);
      log(`downloaded sample → ${OUT}/export-sample.csv (${dl.suggestedFilename()})`);
    } else {
      log("no download yet — inspect export-04-prompt.png / export-prompt.txt");
    }
  } catch (err) {
    log(`ERROR: ${err?.message ?? err}`);
    await page.screenshot({ path: `${OUT}/export-error.png`, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await session.close();
  }
}

main();
