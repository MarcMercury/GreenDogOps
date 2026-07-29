// Reusable CE Broker (Propelus) provider browser session for the agent.
//
// CE Broker does NOT approve CE — AAVSB RACE does. This session drives the
// PROVIDER portal to hand a RACE-approved course to CE Broker (New Course
// wizard) and to report completions. It is intended for SEMI-AUTOMATED use: a
// human is present to solve any CAPTCHA/MFA, attach files, and click the final
// Finish. The password is read from env and never logged.
//
// Mirrors agent/ezyvet/session.mjs: stealthy Chromium, storageState reuse.
//
// NOTE: CE Broker is a knockout/require.js SPA behind Intercom + GTM. The login
// selectors below are best-effort fallbacks — run `node agent/cebroker/explore.mjs`
// once to confirm the real DOM and tighten them.
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export const CEBROKER_ORIGIN =
  process.env.CEBROKER_ORIGIN ?? "https://providers.cebroker.com";

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
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return context;
}

function isLoggedIn(url) {
  // Off the login/launchpad screens = inside the provider app.
  return !/login|launchpad|signin/i.test(url);
}

/** Fill the first selector that matches, returns true if one was filled. */
async function fillFirst(page, selectors, value) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      await loc.fill(value, { timeout: 8000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

/**
 * Open an authenticated CE Broker provider session.
 *
 * @param {object} opts
 * @param {string} [opts.statePath]  path to persist/reuse storage state
 * @param {boolean} [opts.headless]  default false (semi-automated → show UI)
 * @param {(m:string)=>void} [opts.log]
 * @returns {Promise<{browser, context, page, close: () => Promise<void>}>}
 */
export async function openCebroker(opts = {}) {
  const {
    statePath = ".secrets/cebroker-state.json",
    headless = false,
    log = () => {},
  } = opts;

  const loginUrl =
    process.env.CEBROKER_LOGIN_URL ?? `${CEBROKER_ORIGIN}`;
  const username = process.env.CEBROKER_USERNAME;
  const password = process.env.CEBROKER_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "CEBROKER_USERNAME / CEBROKER_PASSWORD not set (source .secrets/cebroker.env).",
    );
  }

  const browser = await chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
  });

  const reuse = existsSync(statePath);
  let context = await newContext(browser, reuse ? statePath : undefined);
  let page = await context.newPage();

  if (reuse) {
    log("reusing saved session");
    await page
      .goto(`${CEBROKER_ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: 45000 })
      .catch(() => {});
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

  log("loading login");
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);

  log("submitting credentials");
  await fillFirst(
    page,
    [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[name*="user" i]',
      'input[id*="email" i]',
      'input[id*="user" i]',
    ],
    username,
  );
  await fillFirst(
    page,
    [
      'input[type="password"]',
      'input[name*="pass" i]',
      'input[id*="pass" i]',
    ],
    password,
  );
  const submit = page
    .locator(
      'button[type="submit"]:visible, input[type="submit"]:visible, button:has-text("Sign in"):visible, button:has-text("Log in"):visible',
    )
    .first();
  if (await submit.count().catch(() => 0)) await submit.click().catch(() => {});
  else
    await page
      .press('input[type="password"]', "Enter")
      .catch(() => {});

  // Give the SPA + any human CAPTCHA/MFA up to ~2 min to reach the app.
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    if (isLoggedIn(page.url())) break;
  }

  if (!isLoggedIn(page.url())) {
    throw new Error(
      "Login not completed (still on login/launchpad). If a CAPTCHA/MFA is shown, run headless:false and complete it manually.",
    );
  }

  mkdirSync(dirname(statePath), { recursive: true });
  await context.storageState({ path: statePath });
  log(`login OK; session saved → ${statePath}`);

  return { browser, context, page, close: () => browser.close() };
}
