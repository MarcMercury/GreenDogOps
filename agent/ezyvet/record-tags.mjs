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
import { pickTagSuggestion } from "./tag-pick.mjs";

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
 *
 * Typing resolves on its own only when exactly one tag matches. When names
 * collide across groups ("AP" in General vs "ap" in MyPetClient) the matching
 * suggestion is clicked explicitly — by the catalog's ezyVet id, else by exact
 * title within the catalog's group (see tag-pick.mjs).
 */
async function setTagValue(page, index, tagLabel, log = () => {}, { tagId = null, tagGroup = null } = {}) {
  const idSelector = `input[name="${filterField(index, "animalTag")}"]`;
  const row = page.locator(idSelector).locator("xpath=..");
  const search = row.locator("input.dropDownField").first();

  await search.click();
  await page.keyboard.type(tagLabel, { delay: 80 });
  await page.waitForTimeout(2500);

  let id = await page.locator(idSelector).first().inputValue();
  const wrongId = tagId && id && id !== "0" && String(id) !== String(tagId);
  if (!id || id === "0" || wrongId) {
    const items = await page.evaluate(() =>
      [...document.querySelectorAll("div.dropDownList a.dropDownListItem")]
        .filter((a) => a.offsetWidth || a.offsetHeight)
        .map((a) => {
          const title = a.getAttribute("data-record-title") ?? "";
          const label = a.querySelector("span")?.textContent?.trim() ?? "";
          const rest = label.startsWith(title) ? label.slice(title.length).trim() : "";
          return {
            id: a.getAttribute("data-record-id"),
            title,
            group: rest.startsWith("(") && rest.endsWith(")") ? rest.slice(1, -1) : rest || null,
          };
        }),
    );
    const pick = pickTagSuggestion(items, { label: tagLabel, tagId, group: tagGroup });
    log(
      `pet tag "${tagLabel}" did not resolve by typing; ${items.length} suggestion(s): ` +
        `${items.map((i) => `${i.title}(${i.group ?? ""})#${i.id}`).join(", ")} → ` +
        `${pick ? `picking #${pick.id}` : "no unique match"}`,
    );
    if (pick) {
      await page
        .locator(`div.dropDownList a.dropDownListItem[data-record-id="${pick.id}"]`)
        .first()
        .click();
      await page.waitForTimeout(2000);
      id = await page.locator(idSelector).first().inputValue();
    }
  }

  const shown = await search.inputValue();
  if (!id || id === "0" || (tagId && String(id) !== String(tagId))) {
    throw new Error(
      `Pet tag "${tagLabel}"${tagGroup ? ` (${tagGroup})` : ""}${tagId ? ` #${tagId}` : ""} did not resolve ` +
        `to the right tag id (the box shows "${shown}", id ${id || "0"}) — an unresolved tag filter matches ` +
        `EVERY contact, so the export is refused. Check the tag in ezyVet (node agent/ezyvet/list-tags.mjs ` +
        `lists every tag with its id and group) and fix ezyvet_tag.`,
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
  { tagLabel, tagId = null, tagGroup = null, grain = "contact", activityFrom = null, log = () => {} },
) {
  const spec = GRAINS[grain];
  if (!spec) throw new Error(`unknown record grain "${grain}"`);

  await openRecordsTab(page, log);
  await setRecordType(page, spec.recordType, log);
  await addFilterRow(page, 0);

  await page.selectOption(`select[name="${filterField(1, "Type")}"]`, "AnimalTag");
  await page.waitForTimeout(3000);
  const resolvedId = await setTagValue(page, 1, tagLabel, log, { tagId, tagGroup });

  if (activityFrom) {
    log(`activity window: modified since ${activityFrom}`);
    await addFilterRow(page, 0);
    await setFilterDate(page, 2, ACTIVITY_FIELD, ">=", activityFrom);
  }

  const count = await showRecords(page, log);
  if (count === 0) {
    log(`no records carry pet tag "${tagLabel}"${activityFrom ? " in the window" : ""}`);
    return { count: 0, tagId: resolvedId };
  }
  if (count !== null && count > EXPORT_RECORD_LIMIT) {
    throw new Error(
      `${count} records carry pet tag "${tagLabel}", over ezyVet's ${EXPORT_RECORD_LIMIT}-record export cap.`,
    );
  }

  await queueRecordExport(page, { action: spec.action, log });
  return { count, tagId: resolvedId };
}

/**
 * Full single-tag run: baseline the Report Queue, export, download the CSV.
 * The baseline is taken BEFORE queueing because the nightly full Contacts /
 * Animals pull files under the same queue name — without it we could download
 * that instead and tag the entire practice.
 */
export async function runPetTagExport(
  page,
  { tagLabel, tagId = null, tagGroup = null, grain = "contact", activityFrom = null, downloadPath, log = () => {} },
) {
  const spec = GRAINS[grain];
  if (!spec) throw new Error(`unknown record grain "${grain}"`);

  const before = await snapshotQueue(page, spec.queueName, log);
  const { count, tagId: resolvedId } = await exportRecordsWithPetTag(page, {
    tagLabel,
    tagId,
    tagGroup,
    grain,
    activityFrom,
    log,
  });
  if (count === 0) return { path: null, count: 0, tagId: resolvedId };
  const path = await downloadNewQueueCsv(page, {
    downloadPath,
    reportName: spec.queueName,
    before,
    timeoutMs: 600_000,
    log,
  });
  return { path, count, tagId: resolvedId };
}
