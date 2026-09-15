// ezyVet Dashboard ▸ Records automation (the "Record Filter" UI).
//
// A second, richer export path alongside the Report Center: pick a Record Type,
// build All/Any/Excluding field filters, Show Records, then Perform Action ▸
// Export ▸ All ▸ CSV. Appointment records exported this way carry the
// appointment TYPE, pet and contact — detail the Agenda/Report-Center exports
// don't expose.
//
// ezyVet caps an export at 10,000 records, so callers must slice the date range
// (see runAppointmentExport in agent/ezyvet/appointments-export.mjs).
import { EZYVET_ORIGIN } from "./session.mjs";
import { toEzyvetDate } from "./report-center.mjs";

/** Filter row field name, e.g. Array[Filter][1][Type]. */
const filterField = (index, part) =>
  `recordfilterdata_configjson_Array[Filter][${index}][${part}]`;

/** Open Dashboard ▸ Records. The sub-tab id prefix varies per session. */
export async function openRecordsTab(page, log = () => {}) {
  if (!/ezyvet\.com/.test(page.url())) {
    await page.goto(`${EZYVET_ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
  }
  log("opening Dashboard");
  await page.locator('text="Dashboard"').first().click();
  await page.waitForTimeout(3500);
  log("opening Records tab");
  await page.locator('a.subTab[id$="-Records"]').first().click();
  await page.waitForTimeout(4000);
  await page.locator('select[name="recordClassToProcess"]').first().waitFor({ state: "visible", timeout: 30000 });
}

/**
 * Set the Record Type dropdown. Use the ezyVet VALUE, not the label —
 * "Appointment" is `MetaAppointment`, "Pet" is `Animal`, etc. Changing it
 * re-renders the filter sections, so any existing rows are discarded.
 */
export async function setRecordType(page, value, log = () => {}) {
  log(`record type → ${value}`);
  await page.selectOption('select[name="recordClassToProcess"]', value);
  await page.waitForTimeout(5000);
}

/** Add a filter row to a section (0 = All, 1 = Any, 2 = Excluding). */
async function addFilterRow(page, section = 0) {
  const add = page.locator("span.aButton.button-add");
  await add.nth(section).click();
  await page.waitForTimeout(2500);
}

/** Write a jQuery-UI datepicker input without opening its overlay. */
async function setDateField(page, name, iso) {
  const value = toEzyvetDate(iso);
  await page.evaluate(({ name, value }) => {
    const el = document.querySelector(`input[name="${CSS.escape(name)}"]`);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    const dp = document.getElementById("ui-datepicker-div");
    if (dp) dp.style.display = "none";
  }, { name, value });
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  const got = await page.locator(`input[name="${name}"]`).first().inputValue().catch(() => "");
  if (got !== value) throw new Error(`Records filter date ${name} did not commit (wanted ${value}, got ${got}).`);
}

/**
 * Build the ALL section as `Date >= from` AND `Date <= to`.
 * Both bounds are inclusive; dates are ISO in, MM-DD-YYYY on the form.
 */
export async function setDateWindow(page, fromIso, toIso, log = () => {}, fieldType = "Date") {
  log(`date window ${fromIso} → ${toIso}`);
  await addFilterRow(page, 0);
  await addFilterRow(page, 0);

  for (const [index, comparator, iso] of [[1, ">=", fromIso], [2, "<=", toIso]]) {
    await page.selectOption(`select[name="${filterField(index, "Type")}"]`, fieldType);
    await page.waitForTimeout(2500);
    await page.selectOption(`select[name="${filterField(index, "Comparitor")}"]`, comparator);
    await page.waitForTimeout(500);
    await setDateField(page, filterField(index, "Date"), iso);
  }
}

/** Parse the "Meta Appointments ( 7464 )" heading into a number. */
async function resultCount(page) {
  return page.evaluate(() => {
    const m = document.body.innerText.match(/\(\s*([\d,]+)\s*\)/);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  });
}

/** Click Show Records and wait for the result list. Returns the record count. */
export async function showRecords(page, log = () => {}) {
  log("showing records");
  await page.locator('[data-testid="ShowRecords"]').first().click();
  // The query is slow for wide windows; poll for the "( n )" count heading.
  const deadline = Date.now() + 240_000;
  let count = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    count = await resultCount(page);
    if (count !== null) break;
  }
  log(`records matched: ${count ?? "unknown"}`);
  return count;
}

/**
 * Perform Action ▸ Export - Appointments ▸ All.
 *
 * The export does NOT download directly: it opens the Agenda report form
 * pre-scoped to the filtered records, and "Queue Report" pushes the CSV into
 * the Reporting ▸ Report Queue. Returns once the form has been queued; the
 * caller downloads from the queue (see appointments-export.mjs).
 *
 * @param {string} action   the `actionToPerform` VALUE, e.g. "ExportAppointments"
 * @param {string[]} checks advanced-option checkbox names to tick
 */
export async function queueRecordExport(page, { action, checks = [], log = () => {} }) {
  log(`perform action: ${action} (All)`);
  // Scope the action to every matched record, not just the visible page.
  await page.locator('input[name="ProcessOn"][value="All"]').first().check({ force: true });
  await page.waitForTimeout(800);
  await page.selectOption('select[name="actionToPerform"]', action);
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="Action"]').first().click();

  // The Agenda output form opens in a modal (CSV is pre-selected).
  await page.locator('[data-testid="QueueReport"]').first().waitFor({ state: "visible", timeout: 60_000 });
  await page.locator('input[name="format"][value="CSV"]').first().check({ force: true }).catch(() => {});

  for (const name of checks) {
    const box = page.locator(`input[type="checkbox"][name="${name}"]`).first();
    if (!(await box.count().catch(() => 0))) {
      log(`WARN: export option "${name}" not on the form`);
      continue;
    }
    await box.check({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(500);
  log(`queueing report (options: ${checks.join(", ") || "defaults"})`);
  await page.locator('[data-testid="QueueReport"]').first().click();
  await page.waitForTimeout(4000);
}


