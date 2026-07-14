// Explore the ezyVet app past login: pass the WAF, authenticate, save the
// storage state for reuse, handle the location picker, then dump the main
// navigation so we can map where the reports live. Screenshots at each step.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const LOGIN_URL = process.env.EZYVET_LOGIN_URL;
const USERNAME = process.env.EZYVET_USERNAME;
const PASSWORD = process.env.EZYVET_PASSWORD;
const OUT = ".secrets/ezyvet-probe";
const STATE = ".secrets/ezyvet-state.json";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
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

async function passWafAndLoad(url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(2000);
    const cookies = await context.cookies();
    if (cookies.some((c) => c.name === "aws-waf-token")) break;
  }
}

try {
  console.log("→ login");
  await passWafAndLoad(LOGIN_URL);
  await page.fill('input#input-email', USERNAME, { timeout: 15000 });
  await page.fill('input#input-password', PASSWORD, { timeout: 15000 });
  const submit = page.locator('button[type="submit"]:visible, input[type="submit"]:visible').first();
  if (await submit.count()) await submit.click();
  else await page.press('input#input-password', "Enter");
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/20-after-login.png`, fullPage: true });

  // Dump the location-picker options (clickable elements with clinic names).
  const pickerOptions = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("a, button, li, div[role='button'], [onclick]"));
    return els
      .map((el) => ({ tag: el.tagName, text: (el.innerText || "").trim().slice(0, 60), id: el.id, cls: (el.className || "").toString().slice(0, 60) }))
      .filter((e) => /sherman|van nuys|venice|gdd|mpmv|database|green dog/i.test(e.text));
  });
  console.log("location options:", JSON.stringify(pickerOptions, null, 2));

  // Click "Green Dog - Sherman Oaks" if present, else the first Green Dog option.
  const pick = page.locator('text=/Green Dog - Sherman Oaks/i').first();
  const fallback = page.locator('text=/Green Dog/i').first();
  if (await pick.count()) {
    console.log("→ selecting Sherman Oaks");
    await pick.click();
  } else if (await fallback.count()) {
    console.log("→ selecting first Green Dog option");
    await fallback.click();
  } else {
    console.log("!! no location option matched");
  }
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/21-dashboard.png`, fullPage: true });
  console.log("landed url:", page.url());
  console.log("title:", await page.title().catch(() => ""));

  // Save the authenticated session for reuse (skip re-login next time).
  await context.storageState({ path: STATE });
  console.log("saved storage state →", STATE);

  // Dump the top navigation / menu items so we can find the Reports area.
  const nav = await page.evaluate(() => {
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const items = q("a, button, [role='menuitem'], [role='tab'], .menu-item, nav *")
      .map((el) => (el.innerText || el.getAttribute("title") || el.getAttribute("aria-label") || "").trim())
      .filter((t) => t && t.length < 40);
    return Array.from(new Set(items)).slice(0, 120);
  });
  console.log("\nnav/menu candidates:\n", JSON.stringify(nav, null, 2));
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
  await page.screenshot({ path: `${OUT}/2x-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
