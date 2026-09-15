// Probe: ezyVet Dashboard ▸ Records (the "Record Filter" UI).
//
// Discovery only — never clicks Export. Dumps the Record Type options, the
// All/Any/Excluding filter row controls, and the Perform Action menu so the
// records-dashboard automation can be written against real selectors.
//
// Run: set -a; source .secrets/ezyvet.env; set +a; node agent/ezyvet/probe-records.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { openEzyvet } from "./session.mjs";
import { switchDepartment, ROOT_DEPARTMENT } from "./report-center.mjs";

const OUT = ".secrets/ezyvet-probe";
const log = (m) => console.log(`[probe-records] ${m}`);

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/records-${name}.png`, fullPage: true }).catch(() => {});
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const session = await openEzyvet({ headless: true, blockAssets: true, log });
  const { page } = session;

  try {
    await switchDepartment(page, ROOT_DEPARTMENT, log);

    log("opening Dashboard");
    await page.locator('text="Dashboard"').first().click();
    await page.waitForTimeout(4000);
    await shot(page, "01-dashboard");

    log("opening Records tab");
    await page.getByText("Records", { exact: true }).first().click();
    await page.waitForTimeout(4000);
    await shot(page, "02-records");

    // Dump every select on the page (Record Type + filter field pickers).
    const selects = await page.evaluate(() =>
      [...document.querySelectorAll("select")].map((s) => ({
        name: s.name,
        id: s.id,
        className: s.className,
        visible: !!(s.offsetWidth || s.offsetHeight),
        value: s.value,
        options: [...s.options].slice(0, 200).map((o) => ({ value: o.value, text: o.text.trim() })),
      })),
    );
    writeFileSync(`${OUT}/records-selects.json`, JSON.stringify(selects, null, 2));
    log(`selects: ${selects.length}`);
    for (const s of selects) {
      log(`  select name=${s.name} id=${s.id} opts=${s.options.length} visible=${s.visible}`);
    }

    // Dump buttons / clickable labels so we can find Show Records + the green +.
    const clickables = await page.evaluate(() =>
      [...document.querySelectorAll("button, input[type=button], input[type=submit], a, .button, [onclick]")]
        .filter((el) => !!(el.offsetWidth || el.offsetHeight))
        .map((el) => ({
          tag: el.tagName,
          id: el.id,
          className: typeof el.className === "string" ? el.className : "",
          text: (el.innerText || el.value || "").replace(/\s+/g, " ").trim().slice(0, 80),
        }))
        .filter((el) => el.text || el.id),
    );
    writeFileSync(`${OUT}/records-clickables.json`, JSON.stringify(clickables, null, 2));
    log(`clickables: ${clickables.length}`);

    // The "add filter row" plus icons.
    const plusIcons = await page.evaluate(() =>
      [...document.querySelectorAll("img, i, span, div")]
        .filter((el) => {
          const c = typeof el.className === "string" ? el.className : "";
          return /add|plus/i.test(c + " " + (el.getAttribute("src") || "") + " " + (el.title || ""));
        })
        .filter((el) => !!(el.offsetWidth || el.offsetHeight))
        .slice(0, 60)
        .map((el) => ({
          tag: el.tagName,
          className: typeof el.className === "string" ? el.className : "",
          id: el.id,
          src: el.getAttribute("src") || "",
          title: el.title || "",
        })),
    );
    writeFileSync(`${OUT}/records-plus.json`, JSON.stringify(plusIcons, null, 2));

    writeFileSync(`${OUT}/records-page.html`, await page.content());
    writeFileSync(`${OUT}/records-page.txt`, await page.evaluate(() => document.body.innerText));
    log(`wrote ${OUT}/records-*.json|html|txt`);
  } catch (err) {
    log(`ERROR: ${err?.message ?? err}`);
    await shot(page, "error");
    process.exitCode = 1;
  } finally {
    await session.close();
  }
}

main();
