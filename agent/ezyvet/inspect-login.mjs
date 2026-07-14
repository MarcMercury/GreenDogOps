// Dump the EzyVet login page structure to discover real selectors.
import { chromium } from "playwright";

const LOGIN_URL = process.env.EZYVET_LOGIN_URL;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const q = (sel) => Array.from(document.querySelectorAll(sel));
  const inputs = q("input").map((el) => ({
    type: el.type, name: el.name, id: el.id,
    placeholder: el.placeholder, autocomplete: el.autocomplete,
    ariaLabel: el.getAttribute("aria-label"), visible: !!(el.offsetParent),
  }));
  const buttons = q("button, input[type=submit]").map((el) => ({
    tag: el.tagName, type: el.type, text: (el.innerText || el.value || "").trim(), id: el.id, name: el.name,
  }));
  const forms = q("form").map((f) => ({ action: f.action, method: f.method, id: f.id }));
  const labels = q("label").map((l) => (l.innerText || "").trim()).filter(Boolean);
  return { title: document.title, url: location.href, forms, inputs, buttons, labels };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
