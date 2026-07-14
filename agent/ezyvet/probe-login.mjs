// One-off EzyVet login access probe.
// Reads credentials from env (never hard-coded). Attempts to log in, then
// reports: page reachable, whether login succeeded, whether MFA/2FA is
// required, and where it landed. Saves a screenshot for inspection.
// The password is never printed.
//
// Usage:
//   set -a; source .secrets/ezyvet.env; set +a
//   node agent/ezyvet/probe-login.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const LOGIN_URL = process.env.EZYVET_LOGIN_URL;
const USERNAME = process.env.EZYVET_USERNAME;
const PASSWORD = process.env.EZYVET_PASSWORD;

if (!LOGIN_URL || !USERNAME || !PASSWORD) {
  console.error("Missing EZYVET_LOGIN_URL / EZYVET_USERNAME / EZYVET_PASSWORD env.");
  process.exit(2);
}

const OUT_DIR = ".secrets/ezyvet-probe";
mkdirSync(OUT_DIR, { recursive: true });

const mask = (u) => (u ? u.replace(/(.).*(@.*)/, "$1***$2") : u);
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
});
const page = await context.newPage();

const result = {
  reachable: false,
  loginFormFound: false,
  submitted: false,
  loggedIn: false,
  mfaRequired: false,
  finalUrl: null,
  title: null,
  notes: [],
};

try {
  log(`→ Opening ${LOGIN_URL} as ${mask(USERNAME)} …`);
  const resp = await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  result.reachable = !!resp && resp.status() < 500;
  result.title = await page.title().catch(() => null);

  // Discover the login fields (EzyVet is a PHP login; probe common selectors).
  const userSel = [
    'input[name="username"]',
    'input[name="email"]',
    'input[type="email"]',
    '#username',
    '#email',
    'input[autocomplete="username"]',
  ];
  const passSel = ['input[type="password"]', 'input[name="password"]', '#password'];

  let userField = null;
  for (const s of userSel) {
    if (await page.locator(s).first().count()) { userField = s; break; }
  }
  let passField = null;
  for (const s of passSel) {
    if (await page.locator(s).first().count()) { passField = s; break; }
  }
  result.loginFormFound = !!(userField && passField);
  result.notes.push(`user field: ${userField ?? "none"} | pass field: ${passField ?? "none"}`);

  if (result.loginFormFound) {
    await page.fill(userField, USERNAME);
    await page.fill(passField, PASSWORD);
    await page.screenshot({ path: `${OUT_DIR}/01-filled.png` });

    // Submit: click a submit button if present, else press Enter.
    const submitBtn = page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in")',
    ).first();
    if (await submitBtn.count()) {
      await Promise.allSettled([
        page.waitForLoadState("networkidle", { timeout: 45000 }),
        submitBtn.click(),
      ]);
    } else {
      await Promise.allSettled([
        page.waitForLoadState("networkidle", { timeout: 45000 }),
        page.press(passField, "Enter"),
      ]);
    }
    result.submitted = true;
    await page.waitForTimeout(3000);

    result.finalUrl = page.url();
    result.title = await page.title().catch(() => null);
    await page.screenshot({ path: `${OUT_DIR}/02-after-submit.png`, fullPage: true });

    const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();

    // Heuristics.
    const mfaHints = ["verification code", "two-factor", "2fa", "authenticator", "one-time", "otp", "verify your identity"];
    result.mfaRequired = mfaHints.some((h) => bodyText.includes(h));

    const failHints = ["incorrect", "invalid", "failed", "try again", "wrong password", "not recognised", "not recognized"];
    const stillOnLogin = /login\.php|\/login/i.test(result.finalUrl) && (await page.locator(passField).count()) > 0;
    const looksFailed = failHints.some((h) => bodyText.includes(h));

    result.loggedIn = !result.mfaRequired && !stillOnLogin && !looksFailed;
    if (stillOnLogin) result.notes.push("Still on a login page after submit.");
    if (looksFailed) result.notes.push("Page shows an error-like message.");
  }
} catch (err) {
  result.notes.push(`ERROR: ${err?.message ?? String(err)}`);
} finally {
  await browser.close();
}

log("\n===== EzyVet login probe result =====");
log(JSON.stringify(result, null, 2));
log(`Screenshots (if any) in ${OUT_DIR}/`);
process.exit(result.reachable ? 0 : 1);
