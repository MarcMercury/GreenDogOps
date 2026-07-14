// ezyVet Report Center automation: open Reporting, pick a report by name, set
// CSV format + date range, run it, and download the generated CSV.
import { EZYVET_ORIGIN, LOCATION_LABELS } from "./session.mjs";

/** Read the clinic currently shown in the ezyVet header, e.g. "Van Nuys". */
async function currentLocationLabel(page) {
  return page.evaluate(() => {
    const m = document.body.innerText.match(/Green Dog - (Sherman Oaks|Van Nuys|Venice)/);
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
  const base = target.replace(/\s*\(BU\)\s*/i, "").trim(); // "Green Dog - Venice"
  const shortName = base.replace("Green Dog - ", "").trim();  // "Venice"
  const current = await currentLocationLabel(page);
  if (current.includes(shortName)) {
    log(`already on ${shortName}`);
    return;
  }
  log(`switching clinic → ${target}`);

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

  // Set Select Department: click the field, type the clinic name, then click the
  // option anchor in the AJAX dropdown list (a.dropDown inside .dropDownList).
  const dept = page.locator('xpath=//*[normalize-space(text())="Select Department"]/following::input[1]').first();
  const option = page.locator(".dropDownList a.dropDown").filter({ hasText: base }).first();
  let picked = false;
  for (let attempt = 0; attempt < 3 && !picked; attempt++) {
    await dept.click();
    await dept.fill("");
    await dept.pressSequentially(shortName, { delay: 70 });
    // Poll for the AJAX-filtered option (hasJaxRequest can be slow).
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      if ((await option.count()) && (await option.isVisible().catch(() => false))) {
        await option.click();
        picked = true;
        break;
      }
    }
  }
  if (!picked) {
    const deptVal = await dept.inputValue().catch(() => "(no input)");
    const anyOpt = await page.locator(".dropDownList a.dropDown").count().catch(() => -1);
    const modalOpen = await page.getByText("Change department or inventory location", { exact: false }).isVisible().catch(() => false);
    throw new Error(`Select Department option for "${base}" never appeared (deptField="${deptVal}", dropDownAnchors=${anyOpt}, modalOpen=${modalOpen})`);
  }
  await page.waitForTimeout(2000);

  // Confirm if the modal is still open (Inventory Location auto-matches). Some
  // flows apply on select and reload immediately, so Continue is best-effort.
  try {
    const cont = page.getByRole("button", { name: /Continue/i }).first();
    if (await cont.count()) await cont.click();
    else await clickVisibleText(page, "Continue");
  } catch { /* modal already applied/closed */ }
  await page.waitForTimeout(8000); // app reloads into the new clinic context
  const after = await currentLocationLabel(page);
  log(`clinic now: ${after}`);
  if (!after.includes(shortName)) {
    throw new Error(`clinic switch to "${shortName}" did not take effect (header still "${after}")`);
  }
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
    await radio.check({ force: true }).catch(async () => {
      await radio.click({ force: true });
    });
    await page.waitForTimeout(300);
    return;
  }
  // Fallback: click the visible label text.
  const label = page.getByText(format, { exact: true }).first();
  if (await label.count()) await label.click();
}

/** Fill the From/To date range (accepts YYYY-MM-DD, converts to MM-DD-YYYY). */
export async function setDateRange(page, fromIso, toIso) {
  const from = toEzyvetDate(fromIso);
  const to = toEzyvetDate(toIso);
  // ezyVet date-range reports use jQuery-UI datepickers named sdate/edate.
  // Focusing/clicking opens an overlay that steals pointer events, so set the
  // values purely via JS and fire input/change so the form state updates.
  const sdate = page.locator('input[name="sdate"]').first();
  await sdate.waitFor({ state: "attached", timeout: 10000 });

  await page.evaluate(({ from, to }) => {
    const set = (name, v) => {
      const el = document.querySelector(`input[name="${name}"]`);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("sdate", from);
    set("edate", to);
    // Hide any open jQuery-UI datepicker overlay.
    const dp = document.getElementById("ui-datepicker-div");
    if (dp) dp.style.display = "none";
  }, { from, to });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  const got = {
    sdate: await sdate.inputValue().catch(() => ""),
    edate: await page.locator('input[name="edate"]').first().inputValue().catch(() => ""),
  };
  if (got.sdate !== from || got.edate !== to) {
    throw new Error(`Date range did not commit (wanted ${from}..${to}, got ${got.sdate}..${got.edate}).`);
  }
}

/**
 * Run the currently-open report (click Print) and download the resulting CSV
 * from the Report Queue. Returns the saved file path.
 */
export async function runAndDownloadCsv(page, { downloadPath, reportName, log = () => {} }) {
  log("running report (Print)");
  const startedAt = Date.now();
  await clickVisibleText(page, "Print");
  await page.waitForTimeout(3000);

  // Open the Report Queue tab.
  const queueTab = page.getByText("Report Queue", { exact: false }).first();
  if (await queueTab.count()) {
    await queueTab.click();
    await page.waitForTimeout(2000);
  }

  // Poll for a freshly generated CSV for this report, refreshing the queue.
  const deadline = startedAt + 180_000; // up to 3 min for generation
  let link = null;
  while (Date.now() < deadline) {
    // A completed CSV appears as a link/row ending in .csv, newest at top.
    const csv = page
      .locator(`text=/${reportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*\\.csv/i`)
      .first();
    if (await csv.count()) {
      link = csv;
      break;
    }
    const refresh = page.getByText("Refresh", { exact: false }).first();
    if (await refresh.count()) await refresh.click();
    await page.waitForTimeout(4000);
  }
  if (!link) throw new Error(`Report CSV never appeared in queue for "${reportName}".`);

  log("downloading generated CSV");
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
  await openReport(page, name, log);
  await selectFormat(page, "CSV");
  if (fromIso && toIso) await setDateRange(page, fromIso, toIso);
  if (configure) await configure(page);
  return runAndDownloadCsv(page, { downloadPath, reportName: name, log });
}
