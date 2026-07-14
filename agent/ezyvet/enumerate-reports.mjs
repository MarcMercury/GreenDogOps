// Enumerate every report in the ezyVet Report Center (all pages). Uses saved session.
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const STATE = ".secrets/ezyvet-state.json";
if (!existsSync(STATE)) { console.error("Run explore-app.mjs first."); process.exit(2); }

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  storageState: STATE,
  viewport: { width: 1600, height: 1000 },
  locale: "en-US", timezoneId: "America/Los_Angeles",
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
});
await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
const page = await context.newPage();

const dumpTitles = () => page.evaluate(() => {
  // The report list rows: grab the left-hand report catalog names only.
  const nodes = Array.from(document.querySelectorAll("h1,h2,h3,.reportName,.report-title,li"));
  return nodes.map((e) => (e.innerText || "").trim()).filter((t) => t && t.length > 2 && t.length < 50);
});

try {
  await page.goto("https://greendog.usw2.ezyvet.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  await page.locator('text="Reporting"').first().click();
  await page.waitForTimeout(4000);

  const all = new Set();
  for (let p = 1; p <= 4; p++) {
    (await dumpTitles()).forEach((t) => all.add(t));
    // Try clicking a "next page" control.
    const next = page.locator('text=/^next$|›|»/i, [aria-label="Next"], .next').first();
    if (await next.count()) { await next.click().catch(() => {}); await page.waitForTimeout(2000); }
    else break;
  }
  const list = Array.from(all).sort();
  console.log(`total distinct labels: ${list.length}`);
  console.log(JSON.stringify(list, null, 2));
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
} finally {
  await browser.close();
}
