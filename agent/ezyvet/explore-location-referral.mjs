// Explore: (1) the header clinic switcher (upper-left), (2) the Referral
// Statistics + Referrer Revenue report forms. Uses saved session.
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const OUT = ".secrets/ezyvet-probe";
const STATE = ".secrets/ezyvet-state.json";
if (!existsSync(STATE)) { console.error("Run explore-app.mjs first."); process.exit(2); }

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  storageState: STATE, viewport: { width: 1600, height: 1000 },
  locale: "en-US", timezoneId: "America/Los_Angeles",
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
});
await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
const page = await context.newPage();

const { openReporting, openReport } = await import("./report-center.mjs");
const log = (m) => console.log(`[i] ${m}`);

try {
  await page.goto("https://greendog.usw2.ezyvet.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);

  // (1) Header clinic switcher — the top-left area shows current location.
  const headerText = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("header *, .header *, [class*='header' i] *, [class*='branch' i], [class*='location' i]"));
    return els.map((e) => (e.innerText || "").trim())
      .filter((t) => t && /sherman|van nuys|venice|gdd|mpmv|invent|location|branch/i.test(t) && t.length < 80)
      .slice(0, 10);
  });
  console.log("header location candidates:", JSON.stringify(headerText, null, 2));

  // Click the location label to see the switcher.
  const locLabel = page.locator("text=/Sherman Oaks/i").first();
  if (await locLabel.count()) {
    await locLabel.click().catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/60-location-switcher.png`, fullPage: false });
    const opts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a,li,button,div"))
        .map((e) => (e.innerText || "").trim())
        .filter((t) => /sherman oaks|van nuys|venice/i.test(t) && t.length < 60),
    );
    console.log("switcher options:", JSON.stringify([...new Set(opts)].slice(0, 15), null, 2));
    await page.keyboard.press("Escape");
  }

  // (2) Referral report forms.
  for (const name of ["Referral Statistics", "Referrer Revenue"]) {
    try {
      await openReporting(page, log);
      await openReport(page, name, log);
      const form = await page.evaluate(() => {
        const vis = (e) => e.offsetParent !== null;
        return {
          formats: Array.from(document.querySelectorAll('input[name="format"]')).map((e) => e.value),
          dateInputs: Array.from(document.querySelectorAll('input[name="sdate"], input[name="edate"]')).map((e) => ({ name: e.name, val: e.value })),
          buttons: [...new Set(Array.from(document.querySelectorAll("button, .button")).filter(vis).map((e) => (e.innerText || "").trim()).filter((t) => t && t.length < 25))].slice(0, 15),
        };
      });
      console.log(`\n[${name}] formats=${JSON.stringify(form.formats)} dates=${JSON.stringify(form.dateInputs)} buttons=${JSON.stringify(form.buttons)}`);
    } catch (e) {
      console.log(`[${name}] ERROR: ${e?.message ?? e}`);
    }
  }
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
} finally {
  await browser.close();
}
