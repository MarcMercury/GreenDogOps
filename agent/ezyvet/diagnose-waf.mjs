// Diagnose the AWS WAF challenge on the EzyVet login.
// Lets the challenge JS run, waits for the aws-waf-token cookie, and reports
// what finally renders. Password never printed.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const LOGIN_URL = process.env.EZYVET_LOGIN_URL;
const OUT = ".secrets/ezyvet-probe";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-dev-shm-usage",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  timezoneId: "America/Los_Angeles",
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
});
// Light stealth: hide webdriver flag.
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});
const page = await context.newPage();

const statuses = [];
page.on("response", (r) => {
  const waf = r.headers()["x-amzn-waf-action"];
  if (r.url().includes("ezyvet.com") || waf) {
    statuses.push({ url: r.url().slice(0, 90), status: r.status(), waf: waf ?? "" });
  }
});

const resp = await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
console.log("initial status:", resp?.status(), "waf:", resp?.headers()["x-amzn-waf-action"] ?? "");

// Give the AWS WAF challenge JS time to run and set the token.
let gotToken = false;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(2500);
  const cookies = await context.cookies();
  gotToken = cookies.some((c) => c.name === "aws-waf-token");
  const title = await page.title().catch(() => "");
  const hasPw = await page.locator('input[type="password"]').count();
  console.log(`t=${(i + 1) * 2.5}s  title="${title}"  pwField=${hasPw}  aws-waf-token=${gotToken}`);
  if (gotToken && hasPw) break;
}

await page.screenshot({ path: `${OUT}/challenge.png`, fullPage: true });
const html = await page.content();
console.log("\nfinal url:", page.url());
console.log("html length:", html.length);
console.log("html snippet:", html.slice(0, 600).replace(/\s+/g, " "));
console.log("\nresponses seen:");
for (const s of statuses.slice(0, 20)) console.log(" ", JSON.stringify(s));

await browser.close();
