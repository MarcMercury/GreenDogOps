// Verify referral report forms + a live clinic switch. Uses saved session.
import { openEzyvet } from "./session.mjs";
import { openReporting, openReport, switchLocation } from "./report-center.mjs";

const log = (m) => console.log(`[v] ${m}`);
const session = await openEzyvet({ log });
const page = session.page;
try {
  await openReporting(page, log);
  for (const name of ["Referral Statistics", "Referrer Revenue"]) {
    try {
      await openReport(page, name, log);
      const form = await page.evaluate(() => {
        const vis = (e) => e.offsetParent !== null;
        return {
          formats: Array.from(document.querySelectorAll('input[name="format"]')).map((e) => e.value),
          dates: Array.from(document.querySelectorAll('input[name="sdate"], input[name="edate"]')).map((e) => e.name),
          buttons: [...new Set(Array.from(document.querySelectorAll("button, .button, span.buttonText")).filter(vis).map((e) => (e.innerText || "").trim()).filter((t) => t && t.length < 25))].slice(0, 12),
        };
      });
      console.log(`[${name}] formats=${JSON.stringify(form.formats)} dateFields=${JSON.stringify(form.dates)} buttons=${JSON.stringify(form.buttons)}`);
      await openReporting(page, log); // reset to report list for next
    } catch (e) {
      console.log(`[${name}] ERROR: ${e?.message ?? e}`);
    }
  }

  // Live clinic switch test.
  console.log("switching to Van Nuys…");
  await switchLocation(page, "van_nuys", log);
  const hdr = await page.evaluate(() => (document.body.innerText.match(/Green Dog - (Sherman Oaks|Van Nuys|Venice)/) || [""])[0]);
  console.log("header now:", hdr);
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
  await page.screenshot({ path: ".secrets/ezyvet-probe/61-verify-referral.png", fullPage: true }).catch(() => {});
} finally {
  await session.close();
}
