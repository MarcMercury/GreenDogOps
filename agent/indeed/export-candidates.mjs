// Indeed for Employers → candidate export assist (SEMI-AUTOMATED, HEADED).
//
// Human-initiated, human-paced. It clicks the dashboard's own "Export
// candidates" control — a sanctioned product feature — and saves the file. It
// does NOT scrape, crawl, or run on a schedule.
//
// Usage (on your own machine, not the dev container):
//   set -a; source .secrets/indeed.env; set +a
//   node agent/indeed/export-candidates.mjs [--no-select-all]
//
// Output: .secrets/indeed-export/<timestamp>-<indeed's filename>
// Then: ATS ▸ ⬆ Import ▸ list mode, and use the bulk-fill bar to set
// position / lead source / application date on any blank rows.
import { openIndeed, INDEED_CANDIDATES_URL } from "./session.mjs";
import { mkdirSync } from "node:fs";

const OUT = ".secrets/indeed-export";

// Export acts on the current selection, so select the whole filtered list first.
const SELECT_ALL_SELECTOR =
  'button:has-text("Select all"):visible, a:has-text("Select all"):visible';
const EXPORT_BUTTON_SELECTOR =
  'button:has-text("Export candidates"):visible, a:has-text("Export candidates"):visible, ' +
  '[data-testid*="export" i]:visible';
const MENU_ITEM_SELECTOR =
  '[role="menuitem"]:visible, [role="option"]:visible, li a:visible, li button:visible';

const skipSelectAll = process.argv.slice(2).includes("--no-select-all");

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

async function main() {
  const log = (m) => console.log(`[indeed:export] ${m}`);
  const { page, close } = await openIndeed({ log });

  await page.goto(INDEED_CANDIDATES_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(6000);

  if (!skipSelectAll) {
    const selectAll = page.locator(SELECT_ALL_SELECTOR).first();
    if (await selectAll.count().catch(() => 0)) {
      const label = ((await selectAll.textContent().catch(() => "")) ?? "").trim();
      log(`clicking "${label}"`);
      await selectAll.click().catch(() => {});
      await page.waitForTimeout(2000);
    } else {
      log('no "Select all" link found — exporting whatever is currently selected');
    }
  }

  const exportBtn = page.locator(EXPORT_BUTTON_SELECTOR).first();
  if (!(await exportBtn.count().catch(() => 0))) {
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/no-export-button.png`, fullPage: true }).catch(() => {});
    log(`could not find the Export control — screenshot at ${OUT}/no-export-button.png`);
    log("leaving the browser open 60s so you can export by hand.");
    await page.waitForTimeout(60000);
    await close();
    return;
  }

  log("opening Export candidates");
  await exportBtn.click().catch(() => {});
  await page.waitForTimeout(2000);

  // It is a dropdown; pick the spreadsheet option if one is offered.
  const items = page.locator(MENU_ITEM_SELECTOR);
  const count = await items.count().catch(() => 0);
  let chosen = null;
  for (let i = 0; i < count; i++) {
    const text = ((await items.nth(i).textContent().catch(() => "")) ?? "").trim();
    if (/csv|excel|spreadsheet|\.xls/i.test(text)) {
      chosen = items.nth(i);
      log(`choosing "${text}"`);
      break;
    }
  }

  let download = null;
  if (chosen) {
    [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 90000 }).catch(() => null),
      chosen.click().catch(() => {}),
    ]);
  } else {
    log(`no spreadsheet option matched among ${count} menu items — waiting for a direct download`);
    download = await page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
  }

  if (!download) {
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/export-menu.png`, fullPage: true }).catch(() => {});
    log(`no download fired — screenshot at ${OUT}/export-menu.png`);
    log("Indeed may email the file instead, or want a confirmation click. Finish in the window (60s).");
    await page.waitForTimeout(60000);
    await close();
    return;
  }

  mkdirSync(OUT, { recursive: true });
  const path = `${OUT}/${stamp()}-${download.suggestedFilename()}`;
  await download.saveAs(path);
  log(`saved → ${path}`);
  log("Import via ATS ▸ ⬆ Import (list mode).");
  await close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
