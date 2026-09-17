// ezyVet PET TAG membership export via Dashboard ▸ Records.
//
// The Report Center cannot answer "which clients have a pet tagged CODE *101*"
// — tags are only exposed through the Records dashboard's filter UI. This
// drives it: Record Type = Contact, one ALL filter row of Pet Tag = <tag>,
// Show Records, then Perform Action ▸ Export - Contacts, which queues an
// ordinary Contacts CSV scoped to the matched records.
//
// Discovered by agent/ezyvet/probe-record-tags.mjs:
//   * filter Type value for "Pet Tag" is `AnimalTag`
//   * the value control is a nameless `input.dropDownField` search box paired
//     with a hidden `input.idField` named Array[Filter][n][animalTag] holding
//     the tag id (0 = unresolved)
//   * the export action is `ExportContacts`, queued under "Contacts"
import {
  openRecordsTab,
  setRecordType,
  addFilterRow,
  filterField,
  setFilterDate,
  showRecords,
  queueRecordExport,
} from "./records-dashboard.mjs";
import { snapshotQueue, downloadNewQueueCsv } from "./report-center.mjs";
import { EXPORT_RECORD_LIMIT } from "./appointments-export.mjs";

/**
 * Per record grain: the Record Type value, the export action, and the report
 * the Report Queue files that export under.
 */
const GRAINS = {
  contact: { recordType: "Contact", action: "ExportContacts", queueName: "Contacts" },
  animal: { recordType: "Animal", action: "ExportAnimals", queueName: "Animals" },
};

/**
 * The filter that scopes a run to recently-touched records.
 *
 * "Date Modified", NOT an invoice/visit filter: a tag is usually added or
 * removed by a staff member editing the record, which bumps the modified date
 * but need not involve a visit at all. Scoping by billing activity would miss
 * exactly the edits we are trying to pick up.
 */
const ACTIVITY_FIELD = "ModifiedDate";

/**
 * Type a tag name into a filter row's search box and confirm ezyVet resolved it
 * to a tag id.
 *
 * An unresolved tag leaves the hidden id at "0", which ezyVet treats as NO
 * FILTER — the export would then silently return all ~33k contacts and every
 * one of them would be recorded as carrying the tag. A rename or typo must
 * fail the run instead, so the resolved id is verified before going further.
 */
async function setTagValue(page, index, tagLabel, log = () => {}) {
  const idSelector = `input[name="${filterField(index, "animalTag")}"]`;
  const row = page.locator(idSelector).locator("xpath=..");
  const search = row.locator("input.dropDownField").first();

  await search.click();
  await page.keyboard.type(tagLabel, { delay: 80 });
  await page.waitForTimeout(2500);

  const id = await page.locator(idSelector).first().inputValue();
  const shown = await search.inputValue();
  if (!id || id === "0") {
    throw new Error(
      `Pet tag "${tagLabel}" did not resolve to a tag id (the box shows "${shown}") — ` +
        `an unresolved tag filter matches EVERY contact, so the export is refused. ` +
        `Check the tag still exists in ezyVet and is spelled exactly.`,
    );
  }
  log(`pet tag "${tagLabel}" → id ${id} (shown as "${shown}")`);
  return id;
}

/**
 * Queue an export of every record carrying `tagLabel`.
 *
 * `activityFrom` (ISO) restricts the run to records modified since that date —
 * the nightly mode. Omit it for a backfill, which reads the whole population.
 *
 * @returns {Promise<{count: number|null, tagId?: string}>}
 */
export async function exportRecordsWithPetTag(
  page,
  { tagLabel, grain = "contact", activityFrom = null, log = () => {} },
) {
  const spec = GRAINS[grain];
  if (!spec) throw new Error(`unknown record grain "${grain}"`);

  await openRecordsTab(page, log);
  await setRecordType(page, spec.recordType, log);
  await addFilterRow(page, 0);

  await page.selectOption(`select[name="${filterField(1, "Type")}"]`, "AnimalTag");
  await page.waitForTimeout(3000);
  const tagId = await setTagValue(page, 1, tagLabel, log);

  if (activityFrom) {
    log(`activity window: modified since ${activityFrom}`);
    await addFilterRow(page, 0);
    await setFilterDate(page, 2, ACTIVITY_FIELD, ">=", activityFrom);
  }

  const count = await showRecords(page, log);
  if (count === 0) {
    log(`no records carry pet tag "${tagLabel}"${activityFrom ? " in the window" : ""}`);
    return { count: 0, tagId };
  }
  if (count !== null && count > EXPORT_RECORD_LIMIT) {
    throw new Error(
      `${count} records carry pet tag "${tagLabel}", over ezyVet's ${EXPORT_RECORD_LIMIT}-record export cap.`,
    );
  }

  await queueRecordExport(page, { action: spec.action, log });
  return { count, tagId };
}

/**
 * Full single-tag run: baseline the Report Queue, export, download the CSV.
 * The baseline is taken BEFORE queueing because the nightly full Contacts /
 * Animals pull files under the same queue name — without it we could download
 * that instead and tag the entire practice.
 */
export async function runPetTagExport(
  page,
  { tagLabel, grain = "contact", activityFrom = null, downloadPath, log = () => {} },
) {
  const spec = GRAINS[grain];
  if (!spec) throw new Error(`unknown record grain "${grain}"`);

  const before = await snapshotQueue(page, spec.queueName, log);
  const { count, tagId } = await exportRecordsWithPetTag(page, {
    tagLabel,
    grain,
    activityFrom,
    log,
  });
  if (count === 0) return { path: null, count: 0, tagId };
  const path = await downloadNewQueueCsv(page, {
    downloadPath,
    reportName: spec.queueName,
    before,
    timeoutMs: 600_000,
    log,
  });
  return { path, count, tagId };
}
