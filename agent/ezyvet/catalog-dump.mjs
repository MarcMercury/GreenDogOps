// Dump the ENTIRE ezyVet Report Center catalog: every report name + description
// + category, across all pages. Read-only probe (never clicks Print).
//
// Run: set -a; source .secrets/ezyvet.env; set +a; node agent/ezyvet/catalog-dump.mjs
import { openEzyvet } from "./session.mjs";
import { openReporting } from "./report-center.mjs";
import { writeFileSync } from "node:fs";

const log = (m) => console.log(`[catalog] ${m}`);

const { browser, page } = await openEzyvet({ locationKey: "sherman_oaks", headless: true, log });

try {
  await openReporting(page, log);

  // Structure probe: what does one catalog row look like?
  const sample = await page.evaluate(() => {
    const a = document.querySelector(".theSideList a.listClickOpenTab");
    return a ? a.outerHTML.slice(0, 1200) : "(no .theSideList a.listClickOpenTab found)";
  });
  log(`sample row HTML:\n${sample}`);

  const pagerText = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/\d+\s+of\s+\d+/g);
    return m ? m.join(" | ") : "(no pager text)";
  });
  log(`pager: ${pagerText}`);

  const seen = new Map();
  const readPage = () =>
    page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".theSideList a.listClickOpenTab"));
      return rows.map((a) => {
        const lines = (a.innerText || "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        return { name: lines[0] || "", description: lines.slice(1).join(" "), raw: (a.innerText || "").trim() };
      });
    });

  for (let p = 1; p <= 12; p++) {
    const rows = await readPage();
    rows.forEach((r) => {
      if (r.name && !seen.has(r.name)) seen.set(r.name, r);
    });
    log(`page ${p}: ${rows.length} rows (total ${seen.size})`);

    // Advance the catalog pager (a#leftlistnext inside .paginate-navigators).
    const before = rows.map((r) => r.name).join("|");
    const next = page.locator("a#leftlistnext").first();
    if (!(await next.count())) {
      log("no pager");
      break;
    }
    await next.click().catch(() => {});
    await page.waitForTimeout(2500);
    const after = (await readPage()).map((r) => r.name).join("|");
    if (!after || after === before) {
      log("no further pages");
      break;
    }
  }

  const list = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(".secrets/ezyvet-probe/report-catalog.json", JSON.stringify(list, null, 2));
  log(`TOTAL ${list.length} reports → .secrets/ezyvet-probe/report-catalog.json`);
  list.forEach((r) => console.log(`- ${r.name} :: ${r.description}`));
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
  await page.screenshot({ path: ".secrets/ezyvet-probe/catalog-fail.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
