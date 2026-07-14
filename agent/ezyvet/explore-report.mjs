// Find a specific report in the ezyVet Report Center and capture its parameter
// form (date range + Run button) so we can automate it. Uses saved session.
// Usage: node agent/ezyvet/explore-report.mjs "Invoice Lines"
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const TERM = process.argv[2] || "Invoice";
const OUT = ".secrets/ezyvet-probe";
const STATE = ".secrets/ezyvet-state.json";
if (!existsSync(STATE)) { console.error("Run explore-app.mjs first."); process.exit(2); }
const slug = TERM.toLowerCase().replace(/[^a-z0-9]+/g, "-");

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

try {
  await page.goto("https://greendog.usw2.ezyvet.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  await page.locator('text="Reporting"').first().click();
  await page.waitForTimeout(4000);

  // Search for the report.
  const filter = page.locator('#filter').first();
  await filter.fill(TERM);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/40-search-${slug}.png`, fullPage: true });

  const matches = await page.evaluate((term) => {
    const t = term.toLowerCase();
    return Array.from(document.querySelectorAll("h1,h2,h3,li,td,a,div"))
      .map((e) => (e.innerText || "").trim())
      .filter((x) => x && x.toLowerCase().includes(t) && x.length < 60);
  }, TERM);
  console.log(`matches for "${TERM}":`, JSON.stringify(Array.from(new Set(matches)).slice(0, 20)));

  // Click the exact report heading.
  const report = page.locator(`text="${TERM}"`).first();
  if (await report.count()) {
    await report.click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/41-report-${slug}.png`, fullPage: true });

    const form = await page.evaluate(() => {
      const vis = (e) => e.offsetParent !== null;
      const inputs = Array.from(document.querySelectorAll("input, select")).filter(vis).map((e) => ({
        tag: e.tagName, type: e.type, name: e.name, id: e.id, placeholder: e.placeholder,
        label: (e.getAttribute("aria-label") || e.getAttribute("title") || "").slice(0, 40),
        value: (e.value || "").slice(0, 30),
      }));
      const buttons = Array.from(document.querySelectorAll("button, input[type=submit], a")).filter(vis)
        .map((e) => (e.innerText || e.value || "").trim()).filter((t) => t && t.length < 30);
      const labels = Array.from(document.querySelectorAll("label, legend")).filter(vis)
        .map((e) => (e.innerText || "").trim()).filter(Boolean).slice(0, 30);
      return { inputs: inputs.slice(0, 40), buttons: Array.from(new Set(buttons)).slice(0, 40), labels };
    });
    console.log("\nform labels:", JSON.stringify(form.labels, null, 2));
    console.log("\nform inputs:", JSON.stringify(form.inputs, null, 2));
    console.log("\nform buttons:", JSON.stringify(form.buttons, null, 2));
  } else {
    console.log(`!! no clickable heading exactly "${TERM}"`);
  }
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
  await page.screenshot({ path: `${OUT}/4x-error-${slug}.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
