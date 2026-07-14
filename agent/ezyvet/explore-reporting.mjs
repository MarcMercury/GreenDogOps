// Explore the ezyVet Reporting area using the saved authenticated session.
// Clicks "Reporting", dumps the report list / search UI, and screenshots.
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const OUT = ".secrets/ezyvet-probe";
const STATE = ".secrets/ezyvet-state.json";
if (!existsSync(STATE)) {
  console.error("No saved session; run explore-app.mjs first.");
  process.exit(2);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  storageState: STATE,
  viewport: { width: 1600, height: 1000 },
  locale: "en-US",
  timezoneId: "America/Los_Angeles",
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});
const page = await context.newPage();

try {
  await page.goto("https://greendog.usw2.ezyvet.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5000);
  console.log("landed:", page.url(), "| logged-in:", !/login\.php/i.test(page.url()));

  // Open the Reporting section.
  const reporting = page.locator('text="Reporting"').first();
  if (await reporting.count()) {
    await reporting.click();
    await page.waitForTimeout(5000);
  } else {
    console.log("!! Reporting menu not found");
  }
  await page.screenshot({ path: `${OUT}/30-reporting.png`, fullPage: true });
  console.log("after Reporting click:", page.url());

  // Dump anything that looks like a report name / list item / search field.
  const dump = await page.evaluate(() => {
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const inputs = q("input").filter((e) => e.offsetParent).map((e) => ({
      type: e.type, name: e.name, id: e.id, placeholder: e.placeholder,
    }));
    const links = q("a, li, .report, [role='row'], td, .list-item, button")
      .map((e) => (e.innerText || "").trim())
      .filter((t) => t && t.length > 2 && t.length < 60);
    const headings = q("h1,h2,h3,legend,.title,.header").map((e) => (e.innerText || "").trim()).filter(Boolean);
    return {
      inputs: inputs.slice(0, 25),
      headings: Array.from(new Set(headings)).slice(0, 30),
      candidates: Array.from(new Set(links)).slice(0, 150),
    };
  });
  console.log("\nheadings:", JSON.stringify(dump.headings, null, 2));
  console.log("\ninputs:", JSON.stringify(dump.inputs, null, 2));
  console.log("\nreport candidates:", JSON.stringify(dump.candidates, null, 2));
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
  await page.screenshot({ path: `${OUT}/3x-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
