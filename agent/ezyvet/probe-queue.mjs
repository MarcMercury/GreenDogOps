// Dump the newest rows of the inline Reporting queue list (#reportingQueueList*).
import { mkdirSync, writeFileSync } from "node:fs";
import { openEzyvet } from "./session.mjs";
import { openReporting } from "./report-center.mjs";

const OUT = ".secrets/ezyvet-probe";
const log = (m) => console.log(`[qlist] ${m}`);

const session = await openEzyvet({ headless: true, blockAssets: true, log });
const { page } = session;
try {
  mkdirSync(OUT, { recursive: true });
  await openReporting(page, log);
  await page.locator('[id^="reportingQueueList"] tr').first().waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForTimeout(3000);
  const rows = await page.evaluate(() => {
    const list = document.querySelector('[id^="reportingQueueList"]');
    if (!list) return ["NO LIST"];
    return [...list.querySelectorAll("tr")]
      .map((tr) => (tr.innerText || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 25);
  });
  rows.forEach((r, i) => log(`${i}: ${r.slice(0, 180)}`));
  const links = await page.evaluate(() => {
    const list = document.querySelector('[id^="reportingQueueList"]');
    return [...(list?.querySelectorAll("a") ?? [])].slice(0, 15).map((a) => (a.textContent || "").trim());
  });
  log(`links: ${JSON.stringify(links)}`);
  writeFileSync(`${OUT}/queue-rows.txt`, rows.join("\n"));
} catch (err) {
  log(`ERROR: ${err?.message ?? err}`);
} finally {
  await session.close();
}
