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
  // type the clinic name, then click the option ANCHOR. The option row uniquely
  // doubles the clinic name ("Green Dog - Van Nuys(Green Dog - Van Nuys)"), so
  // match that on the <a> — clicking the inner text span doesn't fire its handler.
  const dept = page.locator('xpath=//*[normalize-space(text())="Select Department"]/following::input[1]').first();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const optRe = new RegExp(`${esc(base)}[\\s\\S]*${esc(base)}`, "i");
  const option = page.locator("a").filter({ hasText: optRe }).first();
  let picked = false;
  for (let attempt = 0; attempt < 3 && !picked; attempt++) {
    await dept.click();
    await page.waitForTimeout(1200);
    await dept.fill("");
    await dept.pressSequentially(shortName, { delay: 80 });
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

  await page.waitForTimeout(9000); // app reloads into the new clinic context
  const after = await currentLocationLabel(page);
  log(`clinic now: ${after}`);
  if (!after.includes(shortName)) {
    await page.screenshot({ path: `.secrets/ezyvet-probe/switch-fail-${shortName.replace(/\s+/g, "_")}.png`, fullPage: true }).catch(() => {});
    await dismissModal(page);
    throw new Error(`clinic switch to "${shortName}" did not take effect (header still "${after}")`);
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

/** Build the regex that matches a completed CSV row for `reportName`. */
function csvRowRegex(reportName) {
  return new RegExp(`${reportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*\\.csv`, "i");
}

/** Switch to a sub-tab ("Details" | "Report Queue") of the open report. */
async function openReportSubTab(page, label) {
  const tab = page.getByText(label, { exact: false }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(1500);
  }
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
 * return to the Details form. Called BEFORE running so the download step can
 * tell this run's CSV apart from stale entries. The Report Queue retains prior
 * runs under the SAME report name — other locations and earlier days — so
 * downloading the newest name match without this snapshot can grab the wrong
 * file (this is what mis-assigned the per-location Referrer Revenue results:
 * a Van Nuys run picking up Venice's file, or an empty leftover).
 */
async function snapshotQueue(page, reportName) {
  await openReportSubTab(page, "Report Queue");
  const before = new Set(await queueRowSignatures(page, csvRowRegex(reportName)));
  await openReportSubTab(page, "Details");
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
  await page.waitForTimeout(3000);
  await openReportSubTab(page, "Report Queue");

  // Poll for a NEW completed CSV — a row whose signature was not in the queue
  // before we clicked Print — refreshing the queue between checks.
  const deadline = startedAt + 180_000; // up to 3 min for generation
  let newIndex = -1;
  while (Date.now() < deadline) {
    const sigs = await queueRowSignatures(page, nameRe);
    newIndex = sigs.findIndex((sig) => !before.has(sig));
    if (newIndex >= 0) break;
    const refresh = page.getByText("Refresh", { exact: false }).first();
    if (await refresh.count()) await refresh.click();
    await page.waitForTimeout(4000);
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
  await openReport(page, name, log);
  // Snapshot the queue before filling the form so switching to the queue tab
  // and back never disturbs the format/date inputs.
  const before = await snapshotQueue(page, name);
  await selectFormat(page, "CSV");
  if (fromIso && toIso) await setDateRange(page, fromIso, toIso);
  if (configure) await configure(page);
  return runAndDownloadCsv(page, { downloadPath, reportName: name, before, log });
}
