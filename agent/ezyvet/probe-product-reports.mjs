// One-off probe: list Report Center catalog entries matching product/price/stock
// search terms, so we can pick the right source for the product catalog ingest.
//   set -a; source .secrets/ezyvet.env; set +a; node agent/ezyvet/probe-product-reports.mjs
import { openEzyvet } from "./session.mjs";
import { openReporting } from "./report-center.mjs";

const TERMS = process.argv.slice(2).length ? process.argv.slice(2) : ["product", "price", "stock", "inventory"];
const log = (m) => console.log(`[probe] ${m}`);

const session = await openEzyvet({ locationKey: "sherman_oaks", log });
const page = session.page;
try {
  await openReporting(page, log);
  for (const term of TERMS) {
    const filter = page.locator("#filter").first();
    await filter.click();
    await filter.fill("");
    await filter.pressSequentially(term, { delay: 40 });
    await page.waitForTimeout(2500);
    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".theSideList a.listClickOpenTab"))
        .filter((e) => e.offsetParent !== null)
        .map((e) => (e.innerText || "").trim())
        .filter(Boolean),
    );
    console.log(`\n== ${term} ==`);
    console.log(JSON.stringify(rows, null, 1));
  }
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
} finally {
  await session.close?.();
}
