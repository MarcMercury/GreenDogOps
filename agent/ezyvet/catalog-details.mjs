// Open every report in the ezyVet Report Center and capture its description +
// parameter form (date range? format options? filters?). READ-ONLY: never
// clicks Print/Submit, so nothing is generated, charged, sent, or changed.
//
// Run: set -a; source .secrets/ezyvet.env; set +a; node agent/ezyvet/catalog-details.mjs
import { openEzyvet } from "./session.mjs";
import { openReporting } from "./report-center.mjs";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const log = (m) => console.log(`[details] ${m}`);
const OUT = ".secrets/ezyvet-probe/report-details.json";

// Wizards that may start work on open — never touch these.
const SKIP = new Set(["End Of Day Wizard"]);

const names = JSON.parse(readFileSync(".secrets/ezyvet-probe/report-catalog.json", "utf8")).map((r) => r.name);
const done = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};

const { browser, page } = await openEzyvet({ locationKey: "sherman_oaks", headless: true, log });

async function catalogRow(title) {
  // Page through the catalog until the row with this exact title is rendered.
  for (let p = 0; p < 4; p++) {
    const row = page.locator(`.theSideList a.listClickOpenTab[data-record-title="${title.replace(/"/g, '\\"')}"]`).first();
    if ((await row.count()) && (await row.isVisible().catch(() => false))) return row;
    const next = page.locator("a#leftlistnext").first();
    if (!(await next.count())) break;
    await next.click().catch(() => {});
    await page.waitForTimeout(1800);
  }
  return null;
}

try {
  for (const name of names) {
    if (done[name] || SKIP.has(name)) continue;
    try {
      await openReporting(page, () => {});
      const row = await catalogRow(name);
      if (!row) {
        done[name] = { error: "row not found" };
        log(`${name}: row not found`);
        continue;
      }
      await row.click();
      await page.waitForTimeout(3500);

      const info = await page.evaluate(() => {
        const main = document.querySelector("#rightpane") || document.querySelector(".tabContent") || document.body;
        const text = (main.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
        const fields = Array.from(main.querySelectorAll("input,select,textarea")).map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.type || "",
          name: el.name || "",
          id: el.id || "",
          value: el.type === "checkbox" || el.type === "radio" ? el.value : "",
          checked: el.checked === true,
          hidden: !(el.offsetParent !== null || el.type === "hidden" ? el.type !== "hidden" : false),
        }));
        return { text: text.slice(0, 60), fields };
      });

      const fieldNames = [...new Set(info.fields.map((f) => f.name).filter(Boolean))];
      const formats = [...new Set(info.fields.filter((f) => f.name === "format").map((f) => f.value))];
      done[name] = {
        description: info.text.slice(0, 12).join(" | "),
        hasDateRange: fieldNames.includes("sdate") || fieldNames.includes("edate"),
        formats,
        fieldNames,
      };
      log(`${name}: dates=${done[name].hasDateRange} formats=${formats.join("/") || "-"} fields=${fieldNames.length}`);
      writeFileSync(OUT, JSON.stringify(done, null, 2));
    } catch (err) {
      done[name] = { error: err?.message ?? String(err) };
      log(`${name}: ERROR ${done[name].error}`);
      writeFileSync(OUT, JSON.stringify(done, null, 2));
    }
  }
} finally {
  writeFileSync(OUT, JSON.stringify(done, null, 2));
  await browser.close();
}
log(`wrote ${OUT}`);
