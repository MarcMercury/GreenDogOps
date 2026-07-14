// One-off probe: run the Agenda report for a small FUTURE date range on the
// current clinic (Sherman Oaks via saved session) and dump the CSV header +
// first rows so we can learn the columns. Safe to delete.
import { chromium } from "playwright";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openReporting, openReport, selectFormat, setDateRange, clickVisibleText } from "./report-center.mjs";

const STATE = ".secrets/ezyvet-state.json";
if (!existsSync(STATE)) { console.error("Run explore-app.mjs first."); process.exit(2); }

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
const to = new Date(today);
to.setDate(to.getDate() + 28);

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  storageState: STATE,
  viewport: { width: 1600, height: 1000 },
  locale: "en-US",
  timezoneId: "America/Los_Angeles",
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
});
await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
const page = await context.newPage();
const log = (m) => console.log(`[probe] ${m}`);

try {
  await page.goto("https://greendog.usw2.ezyvet.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  await openReporting(page, log);
  const dir = mkdtempSync(join(tmpdir(), "agenda-"));
  const csvPath = join(dir, "agenda.csv");

  await openReport(page, "Agenda", log);
  await selectFormat(page, "CSV");
  await setDateRange(page, iso(today), iso(to));
  // Enable the detailed report so department/resource columns are present.
  const detailed = page.getByText("Show detailed report", { exact: false }).first();
  if (await detailed.count()) await detailed.click().catch(() => {});
  await page.waitForTimeout(500);

  log("running report (Print)");
  await clickVisibleText(page, "Print");
  await page.waitForTimeout(4000);
  const queueTab = page.getByText("Report Queue", { exact: false }).first();
  if (await queueTab.count()) { await queueTab.click(); await page.waitForTimeout(2500); }

  // Poll the queue; dump its visible rows each pass so we can see the filename.
  let link = null;
  for (let i = 0; i < 30 && !link; i++) {
    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a, td, div"))
        .map((e) => (e.innerText || "").trim())
        .filter((t) => /\.csv|\.xls|agenda/i.test(t) && t.length < 80));
    if (i % 5 === 0) console.log(`[poll ${i}] queue:`, JSON.stringify(Array.from(new Set(rows)).slice(0, 8)));
    const csv = page.locator("text=/agenda.*\\.csv/i").first();
    if (await csv.count()) { link = csv; break; }
    // Reload the reporting page to refresh the queue (Refresh div isn't clickable).
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(3000);
    await openReporting(page, () => {});
    const qt = page.getByText("Report Queue", { exact: false }).first();
    if (await qt.count()) { await qt.click(); await page.waitForTimeout(2500); }
  }
  if (!link) throw new Error("Agenda CSV never appeared in queue");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    link.click(),
  ]);
  await download.saveAs(csvPath);
  await download.saveAs(".secrets/ezyvet-probe/agenda-sample.csv");
  const text = readFileSync(csvPath, "utf8");
  const lines = text.split(/\r?\n/);
  console.log(`\n=== CSV ${csvPath} (${lines.length} lines) ===`);
  console.log("HEADER:", lines[0]);
  console.log("\nFIRST 6 DATA ROWS:");
  for (const l of lines.slice(1, 7)) console.log(l);
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
  await page.screenshot({ path: ".secrets/ezyvet-probe/agenda-error.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
