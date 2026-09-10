// ezyVet Report Center automation: open Reporting, pick a report by name, set
// CSV format + date range, run it, and download the generated CSV.
import { EZYVET_ORIGIN, LOCATION_LABELS } from "./session.mjs";

/** Parent department that owns the org-wide contact list. */
export const ROOT_DEPARTMENT = "GDD & MPMV";

/** Read the department currently shown in the ezyVet header. */
async function currentDepartmentLabel(page) {
  return page.evaluate(() => {
    // The header block is the first few lines of the page: organization,
    // department, inventory location. Only look there — the department names
    // also appear deeper in the page (report rows, pickers).
    const head = document.body.innerText.split("\n").slice(0, 4).join("\n");
    const m = head.match(/Green Dog - (Sherman Oaks|Van Nuys|Venice)|GDD & MPMV/);
    return m ? m[0] : "";
  });
}

/**
 * Switch the reporting clinic — this is a PROGRAM-LEVEL setting, not per report.
 * Click the header location block (upper-left) → "Change department or inventory
 * location" modal → set Select Department to the target clinic → Continue (the
 * Inventory Location auto-matches, so we leave it alone). Required before per-
 * location reports (e.g. Referrer Revenue).
 */
export async function switchLocation(page, locationKey, log = () => {}) {
  const target = LOCATION_LABELS[locationKey];
  if (!target) throw new Error(`Unknown location key: ${locationKey}`);
  return switchDepartment(page, target, log);
}

/**
 * Switch the header department to `label`. Accepts a clinic ("Green Dog - Van
 * Nuys") or the parent department ("GDD & MPMV"), which scopes reports to the
 * whole organization rather than one clinic — the Contacts report only exports
 * the selected department's contacts, so the parent is required for the full list.
 */
export async function switchDepartment(page, label, log = () => {}) {
  const base = label.replace(/\s*\(BU\)\s*/i, "").trim(); // "Green Dog - Venice"
  const shortName = base.replace("Green Dog - ", "").trim();  // "Venice"
  const current = await currentDepartmentLabel(page);
  if (current && (current === base || current.includes(shortName))) {
    log(`already on ${shortName}`);
    return;
  }
  log(`switching department → ${base}`);

  // Dismiss any modal left open by a previous (failed) switch attempt.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);

  // Open the switcher modal via the header location block (upper-left).
  const openers = [/GDD & MPMV/i, /Sherman Oaks - Invent/i, /Van Nuys - Invent/i, /Venice - Invent/i, /Green Dog - (Sherman Oaks|Van Nuys|Venice)/i];
  let opened = false;
  for (const re of openers) {
    const o = page.getByText(re).first();
    if ((await o.count()) && (await o.isVisible().catch(() => false))) {
      await o.click().catch(() => {});
      try {
        await page.getByText("Change department or inventory location", { exact: false })
          .waitFor({ state: "visible", timeout: 5000 });
        opened = true;
        break;
      } catch { /* try next opener */ }
    }
  }
  if (!opened) throw new Error("could not open the department switcher modal");

  // Set Select Department: click the field to open the (small) department list,
  // type the department name, then click the option ANCHOR. Clinic rows double
  // the name ("Green Dog - Van Nuys(Green Dog - Van Nuys)"), while the parent
  // row shows it once — match either on the <a>, since clicking the inner text
  // span doesn't fire its handler.
  const dept = page.locator('xpath=//*[normalize-space(text())="Select Department"]/following::input[1]').first();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  // The dropdown's type-ahead returns nothing for "&", so search the first word.
  const searchTerm = shortName.split(" & ")[0];
  const doubledRe = new RegExp(`${esc(base)}[\\s\\S]*${esc(base)}`, "i");
  const exactRe = new RegExp(`^\\s*${esc(base)}\\s*$`, "i");
  const candidates = [
    page.locator("a").filter({ hasText: doubledRe }).first(),
    page.locator("a").filter({ hasText: exactRe }).first(),
  ];
  let picked = false;
  for (let attempt = 0; attempt < 3 && !picked; attempt++) {
    await dept.click();
    await page.waitForTimeout(1200);
    await dept.fill("");
    await dept.pressSequentially(searchTerm, { delay: 80 });
    for (let i = 0; i < 15 && !picked; i++) {
      await page.waitForTimeout(1000);
      for (const option of candidates) {
        if ((await option.count()) && (await option.isVisible().catch(() => false))) {
          await option.click();
          picked = true;
          break;
        }
      }
    }
  }
  if (!picked) {
    await page.screenshot({ path: `.secrets/ezyvet-probe/switch-fail-${shortName.replace(/\s+/g, "_")}.png`, fullPage: true }).catch(() => {});
    await dismissModal(page);
    throw new Error(`Select Department option for "${base}" never appeared`);
  }
  await page.waitForTimeout(1500);

  // Confirm — Continue applies the change (Inventory Location auto-matches).
  const cont = page.getByRole("button", { name: /Continue/i }).first();
  if (await cont.count()) await cont.click();
  else await clickVisibleText(page, "Continue");
  await page.waitForTimeout(1500);

  // ezyVet then asks "Change the department and inventory location?" → click Yes.
  try {
    const yes = page.getByRole("button", { name: /^Yes$/i }).first();
    if (await yes.count()) await yes.click();
    else await clickVisibleText(page, "Yes");
  } catch { /* no confirm dialog */ }

  await page.waitForTimeout(9000); // app reloads into the new department context
  const after = await currentDepartmentLabel(page);
  log(`department now: ${after}`);
  if (!after.includes(shortName)) {
    await page.screenshot({ path: `.secrets/ezyvet-probe/switch-fail-${shortName.replace(/\s+/g, "_")}.png`, fullPage: true }).catch(() => {});
    await dismissModal(page);
    throw new Error(`department switch to "${shortName}" did not take effect (header still "${after}")`);
  }
}

/** Best-effort close of the department switcher modal (Cancel or Escape). */
async function dismissModal(page) {
  const cancel = page.getByRole("button", { name: /^Cancel$/i }).first();
  if (await cancel.count().catch(() => 0)) await cancel.click().catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(800);
}


/** Format a YYYY-MM-DD date as ezyVet's MM-DD-YYYY. */
export function toEzyvetDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${m}-${d}-${y}`;
}

/** Click the first VISIBLE element whose exact text matches `label`. */
export async function clickVisibleText(page, label) {
  const loc = page.getByText(label, { exact: true });
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      return true;
    }
  }
  throw new Error(`No visible element with text "${label}".`);
}

/** Open the Reporting section (Report Center). */
export async function openReporting(page, log = () => {}) {
  if (!/ezyvet\.com/.test(page.url())) {
    await page.goto(`${EZYVET_ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
  }
  log("opening Reporting");
  await page.locator('text="Reporting"').first().click();
  await page.waitForTimeout(4000);
}

/**
 * Find a report by its exact name in the left catalog (via the search filter)
 * and open its parameter form in the main panel.
 */
export async function openReport(page, name, log = () => {}) {
  log(`searching report: ${name}`);
  const filter = page.locator("#filter").first();
  await filter.click();
  await filter.fill("");
  // Type char-by-char so the live (React) catalog filter actually fires.
  await filter.pressSequentially(name, { delay: 40 });
  await page.waitForTimeout(2500);

  // Click the report row in the LEFT CATALOG only (a.listClickOpenTab inside
  // ul.theSideList). Scoping here avoids matching the top-nav menu or the
  // Report Queue history for common names like "Contacts".
  const row = page
    .locator(".theSideList a.listClickOpenTab")
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
  try {
    await row.waitFor({ state: "visible", timeout: 12000 });
    await row.click();
  } catch {
    // Fallback: any visible catalog anchor whose text contains the name.
    const alt = page.locator(".theSideList a.listClickOpenTab", { hasText: name }).first();
    if ((await alt.count()) && (await alt.isVisible().catch(() => false))) {
      await alt.click();
    } else {
      await page.screenshot({ path: ".secrets/ezyvet-probe/51-open-report-fail.png", fullPage: true }).catch(() => {});
      throw new Error(`Could not find report "${name}" in the catalog.`);
    }
  }
  await page.waitForTimeout(4000);
  log(`opened report form: ${name}`);
}

/** Select the export format (Excel | CSV | HTML | PDF) via its radio. */
export async function selectFormat(page, format = "CSV") {
  const radio = page.locator(`input[name="format"][value="${format}"]`).first();
  if (await radio.count()) {
    // Some reports (e.g. Animals) render format as a HIDDEN input rather than
    // visible radios — check/click both fail there, so fall back to setting the
    // field directly.
    if (await radio.isVisible().catch(() => false)) {
      await radio.check({ force: true }).catch(async () => {
        await radio.click({ force: true }).catch(() => {});
      });
    } else {
      await page.evaluate((fmt) => {
        for (const el of document.querySelectorAll('input[name="format"]')) {
          if (el.value !== fmt) continue;
          el.checked = true;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, format);
    }
    await page.waitForTimeout(300);
    return;
  }
  // Fallback: click the visible label text.
  const label = page.getByText(format, { exact: true }).first();
  if (await label.count()) await label.click();
}

/**
 * Set one date input by field name (accepts YYYY-MM-DD, writes MM-DD-YYYY).
 * ezyVet renders these as jQuery-UI datepickers whose overlay steals pointer
 * events, so the value is set purely via JS with input/change events fired.
 * Returns false when the field does not exist on the open form.
 */
export async function setDateValue(page, name, iso) {
  const value = toEzyvetDate(iso);
  const field = page.locator(`input[name="${name}"]`).first();
  if (!(await field.count())) return false;

  await page.evaluate(({ name, value }) => {
    const el = document.querySelector(`input[name="${CSS.escape(name)}"]`);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    const dp = document.getElementById("ui-datepicker-div");
    if (dp) dp.style.display = "none";
  }, { name, value });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  const got = await field.inputValue().catch(() => "");
  if (got !== value) throw new Error(`Date field ${name} did not commit (wanted ${value}, got ${got}).`);
  return true;
}

// From/To input names, in the order they are tried. Older reports use
// sdate/edate; the newer report engine (Inventory Movement, Invoice Revenue By
// Group, SMS Volumes) uses bracketed Dates[...] names instead.
const DATE_RANGE_FIELDS = [
  ["sdate", "edate"],
  ["Dates[Start_datetext]", "Dates[End_datetext]"],
];

/** Fill the From/To date range (accepts YYYY-MM-DD, converts to MM-DD-YYYY). */
export async function setDateRange(page, fromIso, toIso) {
  for (const [fromName, toName] of DATE_RANGE_FIELDS) {
    const from = page.locator(`input[name="${fromName}"]`).first();
    if (!(await from.count())) continue;
    await setDateValue(page, fromName, fromIso);
    await setDateValue(page, toName, toIso);
    return;
  }
  throw new Error("No recognised From/To date fields on this report form.");
}

/** Build the regex that matches a completed CSV row for `reportName`. */
function csvRowRegex(reportName) {
  return new RegExp(`${reportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*\\.csv`, "i");
}

/** Click the (global) Report Queue tab within the Reporting section. */
async function openReportQueue(page) {
  const tab = page.getByText("Report Queue", { exact: false }).first();
  if (await tab.count()) {
    await tab.click().catch(() => {});
    await page.waitForTimeout(2000);
  }
}

/**
 * Refresh the Report Queue and leave it open. ezyVet's on-page "Refresh"
 * control is a non-clickable <div> (see probe-agenda), so a full page reload +
 * re-navigation is the reliable way to pull the latest queue state.
 */
async function reloadReportQueue(page, log = () => {}) {
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(3000);
  await openReporting(page, log);
  await openReportQueue(page);
}

/**
 * Read the signature of every completed-CSV row in the Report Queue that
 * matches `nameRe`. Each signature is the enclosing row's text (report name +
 * its generation timestamp), so a fresh run always yields a DISTINCT signature
 * from prior runs of the same report.
 */
async function queueRowSignatures(page, nameRe) {
  return page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, "i");
    const sigs = [];
    document.querySelectorAll("a").forEach((a) => {
      const t = (a.textContent || "").trim();
      if (re.test(t)) {
        const row = a.closest("tr") || a.parentElement;
        sigs.push((row?.innerText || t).replace(/\s+/g, " ").trim());
      }
    });
    return sigs;
  }, nameRe.source);
}

/**
 * Snapshot the Report Queue rows for `reportName` that already exist, then
 * return to the report catalog. Called BEFORE running so the download step can
 * tell this run's CSV apart from stale entries. The Report Queue retains prior
 * runs under the SAME report name — other locations and earlier days — so
 * downloading the newest name match without this snapshot can grab the wrong
 * file (this is what mis-assigned the per-location Referrer Revenue results:
 * a Van Nuys run picking up Venice's file, or an empty leftover).
 */
async function snapshotQueue(page, reportName, log = () => {}) {
  await openReporting(page, log);
  await openReportQueue(page);
  const before = new Set(await queueRowSignatures(page, csvRowRegex(reportName)));
  // Return to the catalog so openReport() can find the report again.
  await openReporting(page, log);
  return before;
}

/**
 * Run the currently-open report (click Print) and download ONLY the CSV that
 * this run generates — i.e. a Report Queue row that was not present in `before`.
 * Returns the saved file path.
 */
export async function runAndDownloadCsv(page, { downloadPath, reportName, before = new Set(), log = () => {} }) {
  const nameRe = csvRowRegex(reportName);

  log("running report (Print)");
  const startedAt = Date.now();
  await clickVisibleText(page, "Print");
  await page.waitForTimeout(4000);

  // Poll for a NEW completed CSV — a row whose signature was not in the queue
  // before we clicked Print. Reload each pass to refresh the queue (the on-page
  // "Refresh" is a non-clickable div), reading the SAME global Report Queue
  // view as the baseline snapshot so the signatures are comparable.
  const deadline = startedAt + 180_000; // up to 3 min for generation
  let newIndex = -1;
  while (Date.now() < deadline) {
    await reloadReportQueue(page, log);
    const sigs = await queueRowSignatures(page, nameRe);
    newIndex = sigs.findIndex((sig) => !before.has(sig));
    if (newIndex >= 0) break;
    await page.waitForTimeout(3000);
  }
  if (newIndex < 0) {
    await page
      .screenshot({ path: `.secrets/ezyvet-probe/queue-no-new-${reportName.replace(/\s+/g, "_")}.png`, fullPage: true })
      .catch(() => {});
    throw new Error(`No freshly generated CSV appeared in the Report Queue for "${reportName}" within 3 min.`);
  }

  log("downloading freshly generated CSV");
  const link = page.locator("a").filter({ hasText: nameRe }).nth(newIndex);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    link.click(),
  ]);
  await download.saveAs(downloadPath);
  log(`saved CSV → ${downloadPath}`);
  return downloadPath;
}

/**
 * High-level: run a Report-Center report end-to-end and return the CSV path.
 * `configure` is an optional hook to set report-specific filters.
 */
export async function runCsvReport(page, opts) {
  const { name, fromIso, toIso, downloadPath, configure, log = () => {} } = opts;
  // Snapshot the queue BEFORE opening/running the report so the download step
  // can pick out THIS run's freshly generated CSV rather than a stale entry.
  const before = await snapshotQueue(page, name, log);
  await openReport(page, name, log);
  await selectFormat(page, "CSV");
  if (fromIso && toIso) await setDateRange(page, fromIso, toIso);
  if (configure) await configure(page);
  return runAndDownloadCsv(page, { downloadPath, reportName: name, before, log });
}
