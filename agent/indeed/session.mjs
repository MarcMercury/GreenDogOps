// Reusable Indeed for Employers browser session (SEMI-AUTOMATED, HEADED).
//
// Intent: a human is present. This script gets you to the employer dashboard and
// saves the session; it never runs unattended and never bulk-crawls. Indeed's
// terms bar automated access, so keep usage to human-paced, human-initiated runs
// of things you could have clicked yourself.
//
// RUN THIS ON YOUR OWN MACHINE, NOT IN THE DEV CONTAINER. A Codespace has a
// datacenter IP and no display; logging in from there looks like a new device on
// an unfamiliar network and will reliably trigger an email OTP (and looks far
// more bot-like). The whole risk argument for this approach depends on it coming
// from your normal IP.
//
// Mirrors agent/cebroker/session.mjs: stealthy Chromium + storageState reuse.
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export const INDEED_EMPLOYER_ORIGIN =
  process.env.INDEED_EMPLOYER_ORIGIN ?? "https://employers.indeed.com";

/** Where the candidate pipeline lives. Overridable — Indeed moves this around. */
export const INDEED_CANDIDATES_URL =
  process.env.INDEED_CANDIDATES_URL ?? `${INDEED_EMPLOYER_ORIGIN}/candidates`;

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

/** Inside the employer app = not parked on an auth/challenge screen. */
function isLoggedIn(url) {
  if (!/employers\.indeed\.com/i.test(url)) return false;
  return !/\/(login|signin|auth)/i.test(url);
}

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
 * Open an authenticated Indeed for Employers session.
 *
 * Credentials are optional: with none set you simply log in by hand in the
 * visible window, which is the lowest-friction path given Indeed emails a
 * one-time code on most new sessions. Either way the session is saved so
 * subsequent runs skip the whole dance.
 *
 * @param {object} opts
 * @param {string} [opts.statePath]   path to persist/reuse storage state
 * @param {number} [opts.loginWaitMs] how long to wait for the human (default 5 min)
 * @param {(m:string)=>void} [opts.log]
 * @returns {Promise<{browser, context, page, close: () => Promise<void>}>}
 */
export async function openIndeed(opts = {}) {
  const {
    statePath = ".secrets/indeed-state.json",
    loginWaitMs = 300000,
    log = () => {},
  } = opts;

  const email = process.env.INDEED_EMAIL;
  const password = process.env.INDEED_PASSWORD;

  // Always headed: a human has to be able to clear the OTP / any challenge.
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const reuse = existsSync(statePath);
  let context = await newContext(browser, reuse ? statePath : undefined);
  let page = await context.newPage();

  if (reuse) {
    log("reusing saved session");
    await page
      .goto(INDEED_CANDIDATES_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
      .catch(() => {});
    await page.waitForTimeout(5000);
    if (isLoggedIn(page.url())) {
      log("saved session still valid");
      return { browser, context, page, close: () => browser.close() };
    }
    log("saved session expired — re-authenticating");
    await context.close();
    context = await newContext(browser, undefined);
    page = await context.newPage();
  }

  log("loading employer sign-in");
  await page.goto(INDEED_CANDIDATES_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(3000);

  if (email) {
    log("prefilling email (you finish the rest in the window)");
    await fillFirst(
      page,
      ['input[type="email"]', 'input[name="__email"]', 'input[id*="email" i]'],
      email,
    );
    const cont = page
      .locator(
        'button[type="submit"]:visible, button:has-text("Continue"):visible, button:has-text("Sign in"):visible',
      )
      .first();
    if (await cont.count().catch(() => 0)) await cont.click().catch(() => {});
    await page.waitForTimeout(4000);

    if (password) {
      await fillFirst(
        page,
        ['input[type="password"]', 'input[name="__password"]'],
        password,
      );
      const submit = page
        .locator('button[type="submit"]:visible, button:has-text("Sign in"):visible')
        .first();
      if (await submit.count().catch(() => 0)) await submit.click().catch(() => {});
    }
  }

  log(
    `waiting up to ${Math.round(loginWaitMs / 60000)} min — complete sign-in / OTP in the browser window…`,
  );
  const deadline = Date.now() + loginWaitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    if (isLoggedIn(page.url())) break;
  }

  if (!isLoggedIn(page.url())) {
    await browser.close();
    throw new Error(
      `Sign-in not completed (still at ${page.url()}). Re-run and finish in the window.`,
    );
  }

  mkdirSync(dirname(statePath), { recursive: true });
  await context.storageState({ path: statePath });
  log(`signed in; session saved → ${statePath}`);
  log("NOTE: that state file is a live credential — it bypasses the OTP. Keep it in .secrets/.");

  return { browser, context, page, close: () => browser.close() };
}
