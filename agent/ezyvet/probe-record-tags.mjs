// Probe: Dashboard ▸ Records ▸ Record Type "Contact" ▸ a TAG filter row.
//
// Discovery only — never clicks Perform Action. Answers the three things the
// tag worker needs and nothing in the codebase currently knows:
//   1. the filter Type option value behind the "Pet Tag" / "Contact Tag" labels
//   2. what the value control is once that Type is chosen (a plain text input,
//      or an autocomplete that writes a hidden id we must resolve first)
//   3. the Perform Action options available for Contact records, and whether
//      the result grid can simply be read instead of exported
//
// Run: set -a; source .secrets/ezyvet.env; set +a; node agent/ezyvet/probe-record-tags.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { openEzyvet } from "./session.mjs";
import { switchDepartment, ROOT_DEPARTMENT } from "./report-center.mjs";
import { openRecordsTab, setRecordType, addFilterRow, filterField, showRecords } from "./records-dashboard.mjs";

const OUT = ".secrets/ezyvet-probe";
const PROBE_TAG = process.env.PROBE_TAG || "CODE *101*";
const log = (m) => console.log(`[probe-tags] ${m}`);
const write = (name, data) =>
  writeFileSync(`${OUT}/rectag-${name}`, typeof data === "string" ? data : JSON.stringify(data, null, 2));

/** Every option of one select, by field name. */
const dumpSelect = (page, name) =>
  page.evaluate((n) => {
    const el = document.querySelector(`select[name="${CSS.escape(n)}"]`);
    if (!el) return null;
    return [...el.options].map((o) => ({ value: o.value, text: o.text.trim() }));
  }, name);

/**
 * Every control in the filter row's DOM container. The value control for a tag
 * filter is a VISIBLE search box that carries no Array[Filter][n] name — only
 * the hidden id input next to it does — so a name-prefix dump misses it.
 */
const dumpRow = (page, index) =>
  page.evaluate((i) => {
    const prefix = `recordfilterdata_configjson_Array[Filter][${i}]`;
    const anchor = [...document.querySelectorAll("select, input")].find(
      (el) => el.name === `${prefix}[Type]`,
    );
    if (!anchor) return { error: "filter row not found" };
    let row = anchor;
    for (let up = 0; up < 6 && row.parentElement; up++) {
      row = row.parentElement;
      if (row.querySelectorAll("input, select").length > 2) break;
    }
    return {
      container: { tag: row.tagName, id: row.id, className: String(row.className).slice(0, 120) },
      controls: [...row.querySelectorAll("input, select, textarea")].map((el) => ({
        tag: el.tagName,
        name: el.name,
        id: el.id,
        type: el.type,
        value: el.value,
        placeholder: el.placeholder || "",
        className: String(el.className).slice(0, 80),
        visible: !!(el.offsetWidth || el.offsetHeight),
        options: el.tagName === "SELECT" ? [...el.options].length : undefined,
      })),
    };
  }, index);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const session = await openEzyvet({ headless: true, blockAssets: true, log });
  const { page } = session;

  try {
    await switchDepartment(page, ROOT_DEPARTMENT, log);
    await openRecordsTab(page, log);
    await setRecordType(page, "Contact", log);

    await addFilterRow(page, 0);
    const types = await dumpSelect(page, filterField(1, "Type"));
    write("filter-types.json", types);

    // 1. Which option is the tag one?
    const tagOptions = (types ?? []).filter((o) => /tag/i.test(o.text));
    log(`tag filter options: ${JSON.stringify(tagOptions)}`);
    if (!tagOptions.length) throw new Error("no filter Type option mentions a tag");

    const petTag = tagOptions.find((o) => /^pet tag$/i.test(o.text)) ?? tagOptions[0];
    log(`selecting Type = ${petTag.value} (${petTag.text})`);
    await page.selectOption(`select[name="${filterField(1, "Type")}"]`, petTag.value);
    await page.waitForTimeout(3000);

    // 2. What does the value control look like now?
    const row = await dumpRow(page, 1);
    write("row-after-type.json", row);
    await page.screenshot({ path: `${OUT}/rectag-01-type.png`, fullPage: true }).catch(() => {});
    log(`row controls: ${JSON.stringify(row.controls)}`);

    // The search box carries no name or id — it is the .dropDownField text
    // input sitting next to the hidden .idField that holds the tag id.
    const rowBox = page.locator(`select#${row.controls[1].id}`).locator("xpath=../..");
    const search = rowBox.locator("input.dropDownField").first();
    log(`search box present: ${await search.count()}`);

    // Capture the autocomplete XHR — if it returns the tag list as JSON we can
    // resolve a tag name to its id at runtime instead of hard-coding ids.
    const xhr = [];
    page.on("response", async (res) => {
      const url = res.url();
      if (!/ajax|autocomplete|search|tag/i.test(url)) return;
      const body = await res.text().catch(() => "");
      xhr.push({ url, status: res.status(), body: body.slice(0, 1500) });
    });

    log(`typing "${PROBE_TAG}"`);
    await search.click();
    await page.keyboard.type(PROBE_TAG, { delay: 120 });
    await page.waitForTimeout(5000);
    write("xhr.json", xhr);
    log(`xhr calls: ${JSON.stringify(xhr.map((x) => x.url.slice(0, 120)))}`);

    const menu = await page.evaluate(() =>
      [...document.querySelectorAll("ul.ui-autocomplete li, .ui-menu-item, .dropDownList li, .dropDownResult")]
        .filter((el) => !!(el.offsetWidth || el.offsetHeight))
        .slice(0, 30)
        .map((el) => ({
          text: el.innerText.replace(/\s+/g, " ").trim(),
          html: el.innerHTML.replace(/\s+/g, " ").trim().slice(0, 240),
        })),
    );
    write("autocomplete.json", menu);
    log(`suggestions: ${JSON.stringify(menu.map((m) => m.text))}`);
    await page.screenshot({ path: `${OUT}/rectag-02-menu.png`, fullPage: true }).catch(() => {});

    if (menu.length) {
      await page
        .locator("ul.ui-autocomplete li, .ui-menu-item, .dropDownList li")
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(2500);
    }
    const resolved = await dumpRow(page, 1);
    write("row-after-value.json", resolved);
    const idField = (resolved.controls ?? []).find((c) => /animalTag/.test(c.name));
    log(`>>> animalTag id for "${PROBE_TAG}" = ${idField?.value}`);
    await page.screenshot({ path: `${OUT}/rectag-03-value.png`, fullPage: true }).catch(() => {});

    // Does the filter actually match? (Show Records is read-only.)
    const count = await showRecords(page, log);
    log(`matched records: ${count}`);
    await page.screenshot({ path: `${OUT}/rectag-03-results.png`, fullPage: true }).catch(() => {});

    // 3. The action list only populates once a result set exists.
    const actions = await dumpSelect(page, "actionToPerform");
    write("actions.json", actions);
    log(`actions: ${JSON.stringify((actions ?? []).map((a) => `${a.value}=${a.text}`))}`);

    // Can we read the grid instead of exporting? Dump its shape.
    const grid = await page.evaluate(() => {
      const table = [...document.querySelectorAll("table")]
        .filter((t) => /code/i.test(t.innerText.slice(0, 200)))
        .sort((a, b) => b.innerText.length - a.innerText.length)[0];
      if (!table) return null;
      const rows = [...table.querySelectorAll("tr")].slice(0, 6).map((tr) =>
        [...tr.querySelectorAll("th, td")].map((c) => c.innerText.replace(/\s+/g, " ").trim()),
      );
      return { id: table.id, className: table.className, rows };
    });
    write("grid.json", grid);
    log(`grid: ${JSON.stringify(grid)?.slice(0, 600)}`);

    write("page.txt", await page.evaluate(() => document.body.innerText));
    log(`wrote ${OUT}/rectag-*`);
  } catch (err) {
    log(`ERROR: ${err?.message ?? err}`);
    await page.screenshot({ path: `${OUT}/rectag-error.png`, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await session.close();
  }
}

main();
