// EzyVet login attempt — passes the AWS WAF challenge, discovers the visible
// login fields, submits credentials, and reports the outcome (success / MFA /
// failure). Password is never printed. Screenshots saved for inspection.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const LOGIN_URL = process.env.EZYVET_LOGIN_URL;
const USERNAME = process.env.EZYVET_USERNAME;
const PASSWORD = process.env.EZYVET_PASSWORD;
const OUT = ".secrets/ezyvet-probe";
mkdirSync(OUT, { recursive: true });
const mask = (u) => (u ? u.replace(/(.).*(@.*)/, "$1***$2") : u);

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  timezoneId: "America/Los_Angeles",
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});
const page = await context.newPage();

const result = { challengePassed: false, loggedIn: false, mfaRequired: false, finalUrl: null, title: null, notes: [] };

try {
  console.log(`→ ${LOGIN_URL} as ${mask(USERNAME)}`);
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });

  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(2000);
    const cookies = await context.cookies();
    result.challengePassed = cookies.some((c) => c.name === "aws-waf-token");
    if (result.challengePassed) break;
  }

  const fields = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input"))
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ type: el.type, name: el.name, id: el.id, placeholder: el.placeholder })),
  );
  console.log("visible inputs:", JSON.stringify(fields));

  const userLoc = page
    .locator('input[type="text"]:visible, input[type="email"]:visible, input[name="username"]:visible, input[name="email"]:visible')
    .first();
  const passLoc = page.locator('input[type="password"]:visible').first();

  await userLoc.fill(USERNAME, { timeout: 15000 });
  await passLoc.fill(PASSWORD, { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/10-filled.png` });

  const submit = page
    .locator('button[type="submit"]:visible, input[type="submit"]:visible, button:has-text("Login"):visible, button:has-text("Log In"):visible, a:has-text("Login"):visible')
    .first();
  if (await submit.count()) await submit.click();
  else await passLoc.press("Enter");

  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);

  result.finalUrl = page.url();
  result.title = await page.title().catch(() => null);
  await page.screenshot({ path: `${OUT}/11-after-login.png`, fullPage: true });

  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  result.mfaRequired = ["verification code", "two-factor", "2fa", "authenticator", "one-time", "otp", "verify your identity", "security code"].some((h) => body.includes(h));
  const stillLogin = (await page.locator('input[type="password"]:visible').count()) > 0;
  const failed = ["incorrect", "invalid", "failed", "try again", "wrong", "not recognised", "not recognized", "locked"].some((h) => body.includes(h));
  result.loggedIn = !result.mfaRequired && !stillLogin && !failed;
  if (stillLogin) result.notes.push("password field still visible after submit");
  if (failed) result.notes.push("error-like text on page");
} catch (err) {
  result.notes.push(`ERROR: ${err?.message ?? String(err)}`);
} finally {
  await browser.close();
}

console.log("\n===== EzyVet login attempt =====");
console.log(JSON.stringify(result, null, 2));
console.log(`Screenshots in ${OUT}/`);
