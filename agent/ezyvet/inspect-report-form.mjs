// Dump the CURRENT values/options of a report form's controls, so we can see
// which saved filter is scoping a report (ezyVet remembers report settings).
// Run: node agent/ezyvet/inspect-report-form.mjs "Appointment Status"
import { openEzyvet } from "./session.mjs";
import { openReporting, openReport, switchDepartment, ROOT_DEPARTMENT } from "./report-center.mjs";

const NAME = process.argv[2];
if (!NAME) { console.error('usage: inspect-report-form.mjs "<Report Name>"'); process.exit(2); }

const log = (m) => console.log(`[form] ${m}`);
const { browser, page } = await openEzyvet({ locationKey: "sherman_oaks", headless: true, log });

try {
  await switchDepartment(page, process.env.DEPARTMENT || ROOT_DEPARTMENT, log);
  await openReporting(page, log);
  await openReport(page, NAME, log);

  const dump = await page.evaluate(() => {
    const main = document.querySelector("#rightpane") || document.body;
    const controls = Array.from(main.querySelectorAll("input,select,textarea")).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      name: el.name || "",
      id: el.id || "",
      value: el.value,
      checked: el.checked === true,
      visible: el.offsetParent !== null,
      options: el.tagName === "SELECT" ? Array.from(el.options).map((o) => `${o.value}=${o.text}`).slice(0, 40) : undefined,
    }));
    // ezyVet dropdowns are text inputs backed by a hidden id field; show the
    // label text sitting next to each so we can tell what a filter is set to.
    const labels = (main.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 80);
    return { controls, labels };
  });

  console.log("LABELS:\n" + dump.labels.join(" | "));
  console.log("\nCONTROLS:");
  for (const c of dump.controls) {
    if (/^formkey|clinicid|reporting_id|win_id|save_and_close|^tab$|^rtab$|recordClassToProcess|recordIdsToProcess/.test(c.name)) continue;
    console.log(`  ${c.name || "(" + c.id + ")"} [${c.tag}/${c.type}] value=${JSON.stringify(c.value)} checked=${c.checked} visible=${c.visible}${c.options ? " options=" + JSON.stringify(c.options) : ""}`);
  }
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
} finally {
  await browser.close();
}
