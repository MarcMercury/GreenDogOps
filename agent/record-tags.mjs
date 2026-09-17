// ezyVet RECORD TAGS worker — who carries which ezyVet tag.
//
// ezyVet tags live only in the Dashboard ▸ Records filter UI; no Report Center
// report lists them. For each tag on the worklist this filters records by that
// tag, exports the matches and POSTs the CSV to
// /api/agents/ezyvet/record-tags, which merges it into the tag's membership.
//
// Two modes, because tags only ever change on records someone has touched:
//   backfill     no activity filter — reads a tag's WHOLE population. Run once
//                per tag to establish the baseline (and again if a tag is ever
//                suspected of having drifted).
//   incremental  adds "Date Modified >= today - ACTIVITY_DAYS", so each nightly
//                run returns a handful of records instead of thousands. Only
//                covers tags that already have a backfill.
//
// Env: EZYVET_USERNAME, EZYVET_PASSWORD, CRON_SECRET, APP_BASE_URL,
//      MODE=backfill|incremental (default incremental)
//      ACTIVITY_DAYS (default 7; incremental only)
//      RECORD_TAGS (bypass the worklist: "code_101=CODE *101*,...")
//      ONLY_TAGS (comma-separated tag_keys to take from the worklist)
//      RUN_ID, RUN_ON, OUT_DIR, DRY_RUN=1
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEzyvet } from "./ezyvet/session.mjs";
import { switchDepartment, ROOT_DEPARTMENT } from "./ezyvet/report-center.mjs";
import { runPetTagExport } from "./ezyvet/record-tags.mjs";
import { reportRun, ensureRun, uploadCsv, getJson } from "./lib/ingest.mjs";

const AGENT_KEY = process.env.AGENT_KEY || "ezyvet_extra_reports";
const MODE = process.env.MODE === "backfill" ? "backfill" : "incremental";
const ACTIVITY_DAYS = Math.max(1, parseInt(process.env.ACTIVITY_DAYS ?? "7", 10) || 7);
const DRY_RUN = process.env.DRY_RUN === "1";
const ONLY = (process.env.ONLY_TAGS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
let RUN_ID = process.env.RUN_ID || null;

function isoLA(offsetDays = 0) {
  const la = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  la.setDate(la.getDate() + offsetDays);
  return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, "0")}-${String(la.getDate()).padStart(2, "0")}`;
}

const RUN_ON = process.env.RUN_ON || isoLA();
// Inclusive lower bound: 7 days means today plus the six days before it. The
// window deliberately overlaps the previous run so a tag edited late in the day
// is not missed by a run that already happened.
const ACTIVITY_FROM = MODE === "incremental" ? isoLA(-(ACTIVITY_DAYS - 1)) : null;

const log = (m) => console.log(`[tags] ${m}`);
async function emit(update) {
  if (RUN_ID) await reportRun({ runId: RUN_ID, ...update });
}

/** Parse the RECORD_TAGS escape hatch: "key=Label,key=Label". */
function parseOverride(spec) {
  return spec
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf("=");
      if (at < 0) throw new Error(`RECORD_TAGS entry "${pair}" must be key=Tag Label`);
      return {
        tag_key: pair.slice(0, at).trim(),
        tag_label: pair.slice(at + 1).trim(),
        tag_type: "pet_tag",
        tag_group: null,
        record_type: "animal",
      };
    });
}

/** The tags this run covers: the app's worklist, or the env override. */
async function worklist() {
  if (process.env.RECORD_TAGS) return parseOverride(process.env.RECORD_TAGS);
  const res = await getJson(`ezyvet/record-tags?mode=${MODE}`);
  if (!res.ok) throw new Error(`could not read the tag worklist: ${res.error}`);
  const tags = res.tags ?? [];
  return ONLY.length ? tags.filter((t) => ONLY.includes(t.tag_key)) : tags;
}

async function main() {
  const tags = await worklist();
  if (!RUN_ID && !DRY_RUN) RUN_ID = await ensureRun(AGENT_KEY, RUN_ON, "scheduled");
  log(
    `${MODE} of ${tags.length} tag(s)` +
      (ACTIVITY_FROM ? ` modified since ${ACTIVITY_FROM}` : " (full population)") +
      ` run=${RUN_ID ?? "(none)"}${DRY_RUN ? " DRY RUN" : ""}`,
  );
  if (!tags.length) {
    log(
      MODE === "incremental"
        ? "nothing to do — no tag has been backfilled yet, so run MODE=backfill first"
        : "nothing to do — the tag catalog is empty",
    );
    await emit({ status: "success", logs: [{ message: "No tags to run." }] });
    return;
  }
  await emit({ status: "running", logs: [{ message: `Record tags: ${MODE} of ${tags.length} tag(s)` }] });

  const dir = process.env.OUT_DIR || mkdtempSync(join(tmpdir(), "ezyvet-tags-"));
  mkdirSync(dir, { recursive: true });
  const detail = {};
  let failures = 0;

  // The record filter is department-scoped, so run under the parent department
  // to cover all three hospitals rather than just Sherman Oaks.
  const session = await openEzyvet({ locationKey: "sherman_oaks", headless: true, blockAssets: true, log });
  try {
    await switchDepartment(session.page, ROOT_DEPARTMENT, log);

    for (const tag of tags) {
      try {
        const file = join(dir, `record-tag-${tag.tag_key}-${RUN_ON}.csv`);
        const { path, count } = await runPetTagExport(session.page, {
          tagLabel: tag.tag_label,
          grain: tag.record_type ?? "animal",
          activityFrom: ACTIVITY_FROM,
          downloadPath: file,
          log: (m) => log(`  ${tag.tag_key}: ${m}`),
        });

        // An incremental run matching nothing is normal — nobody touched a
        // tagged record — and must NOT be posted: there is nothing to merge and
        // nothing to retire.
        if (!path) {
          detail[tag.tag_key] = { status: "success", matched: 0, note: "no records in scope" };
          log(`${tag.tag_key}: 0 records`);
          continue;
        }
        if (DRY_RUN) {
          detail[tag.tag_key] = { status: "success", matched: count, file: path };
          log(`${tag.tag_key}: ${count} records exported to ${path} (dry run, not uploaded)`);
          continue;
        }

        const result = await uploadCsv("ezyvet/record-tags", path, {
          tag_key: tag.tag_key,
          tag_label: tag.tag_label,
          tag_type: tag.tag_type ?? "pet_tag",
          ...(tag.tag_group ? { tag_group: tag.tag_group } : {}),
          record_type: tag.record_type ?? "animal",
          mode: MODE,
          run_on: RUN_ON,
          ...(ACTIVITY_FROM ? { activity_from: ACTIVITY_FROM } : {}),
          filename: `record-tag-${tag.tag_key}.csv`,
        });
        detail[tag.tag_key] = {
          status: "success",
          matched: count,
          added: result.added ?? 0,
          confirmed: result.confirmed ?? 0,
          removed: result.removed ?? 0,
        };
        log(
          `${tag.tag_key}: matched ${count} — ${result.added ?? 0} added, ` +
            `${result.confirmed ?? 0} confirmed, ${result.removed ?? 0} removed`,
        );
        await emit({
          recordsProcessed: result.parsed ?? 0,
          recordsIngested: result.added ?? 0,
          detail,
          logs: [{ message: `${tag.tag_key}: +${result.added ?? 0} / -${result.removed ?? 0}` }],
        });
      } catch (err) {
        failures++;
        const message = err?.message ?? String(err);
        detail[tag.tag_key] = { status: "error", error: message };
        log(`${tag.tag_key}: ERROR ${message}`);
        await emit({ detail, logs: [{ level: "error", message: `${tag.tag_key}: ${message}` }] });
      }
    }
  } finally {
    await session.browser.close().catch(() => {});
  }

  await emit({
    status: failures && failures === tags.length ? "error" : "success",
    detail,
    error: failures ? `${failures} of ${tags.length} tags failed` : undefined,
    logs: [{ message: `Record tags finished (${tags.length - failures}/${tags.length} ok)` }],
  });
  log(`done — ${tags.length - failures}/${tags.length} tags succeeded`);
  // One flaky tag must not fail the whole morning run; a total failure should.
  if (failures && failures === tags.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[tags] fatal:", err?.message ?? err);
  process.exit(1);
});
