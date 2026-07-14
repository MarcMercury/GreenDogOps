// Reusable ezyVet browser session for the agent worker.
//
// Passes the AWS WAF challenge, logs in, selects a clinic location, and can
// persist/reuse the authenticated storage state so subsequent runs skip the
// login + challenge. The password is read from env and never logged.
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export const EZYVET_ORIGIN = "https://greendog.usw2.ezyvet.com";

/** Location label as shown in the ezyVet picker, keyed by our location key. */
export const LOCATION_LABELS = {
  sherman_oaks: "Green Dog - Sherman Oaks",
  van_nuys: "Green Dog - Van Nuys",
  venice: "Green Dog - Venice",
};

function makeContextOptions(storageState) {
  return {
    ...(storageState ? { storageState } : {}),
    viewport: { width: 1600, height: 1000 },
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    userAgent: UA,
    acceptDownloads: true,
  };
}

async function newContext(browser, storageState) {
  const context = await browser.newContext(makeContextOptions(storageState));
  // Light stealth: the AWS WAF challenge flags default headless fingerprints.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return context;
}

async function waitForWaf(context, page) {
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    const cookies = await context.cookies();
    if (cookies.some((c) => c.name === "aws-waf-token")) return true;
  }
  return false;
}

function isLoggedIn(url) {
  return !/login\.php/i.test(url);
}

/**
 * Open an authenticated ezyVet session.
 *
 * @param {object} opts
 * @param {string} [opts.locationKey]  which clinic to select (default sherman_oaks)
 * @param {string} [opts.statePath]    path to persist/reuse storage state
 * @param {boolean} [opts.headless]    default true
 * @param {(m:string)=>void} [opts.log]
 * @returns {Promise<{browser, context, page, close: () => Promise<void>}>}
 */
export async function openEzyvet(opts = {}) {
  const {
    locationKey = "sherman_oaks",
    statePath = ".secrets/ezyvet-state.json",
    headless = true,
    log = () => {},
  } = opts;

  const loginUrl = process.env.EZYVET_LOGIN_URL ?? `${EZYVET_ORIGIN}/login.php`;
  const username = process.env.EZYVET_USERNAME;
  const password = process.env.EZYVET_PASSWORD;
  if (!username || !password) {
    throw new Error("EZYVET_USERNAME / EZYVET_PASSWORD not set.");
  }

  const browser = await chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const reuse = existsSync(statePath);
  let context = await newContext(browser, reuse ? statePath : undefined);
  let page = await context.newPage();

  // Try the saved session first.
  if (reuse) {
    log("reusing saved session");
    await page.goto(`${EZYVET_ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);
    if (isLoggedIn(page.url())) {
      log("saved session still valid");
      return { browser, context, page, close: () => browser.close() };
    }
    log("saved session expired — re-authenticating");
    await context.close();
    context = await newContext(browser, undefined);
    page = await context.newPage();
  }

  // Full login flow.
  log("passing WAF + loading login");
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitForWaf(context, page);

  log("submitting credentials");
  await page.fill("input#input-email", username, { timeout: 15000 });
  await page.fill("input#input-password", password, { timeout: 15000 });
  const submit = page
    .locator('button[type="submit"]:visible, input[type="submit"]:visible')
    .first();
  if (await submit.count()) await submit.click();
  else await page.press("input#input-password", "Enter");
  await page.waitForTimeout(6000);

  // Location picker (skip if already routed into the app).
  if (!isLoggedIn(page.url()) || (await page.locator('text=/select a location/i').count())) {
    const label = LOCATION_LABELS[locationKey] ?? LOCATION_LABELS.sherman_oaks;
    log(`selecting location: ${label}`);
    const exact = page.locator(`text=${label}`).first();
    const anyGreenDog = page.locator("text=/Green Dog/i").first();
    if (await exact.count()) await exact.click();
    else if (await anyGreenDog.count()) await anyGreenDog.click();
    await page.waitForTimeout(6000);
  }

  if (!isLoggedIn(page.url())) {
    await browser.close();
    throw new Error("Login failed (still on login page after credential submit).");
  }

  // Persist the authenticated session for reuse.
  mkdirSync(dirname(statePath), { recursive: true });
  await context.storageState({ path: statePath });
  log(`login OK; session saved → ${statePath}`);

  return { browser, context, page, close: () => browser.close() };
}
