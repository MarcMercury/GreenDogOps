// ezyVet TAG CATALOG — list every tag ezyVet knows, with its id and group.
//
// Read-only. Tags are only exposed through the Dashboard ▸ Records filter's
// tag search box, which POSTs to /General/DropDownList and returns
// <a data-record-id data-record-title><span>Title(Group)</span></a> items. This
// types once to capture that request, then replays it with a raised
// dropDownLimit. If a search still comes back full, it expands the search
// term until every result set fits, so nothing is cut off by the cap.
//
// Covers the Pet Tag box and every group under "-----Tags-----" (Breed,
// Species, Master Problem, …), each of which has its own search box.
//
// Output: JSON { listed_on, incomplete, tags: [{ id, title, group, sources }] } — to OUT_FILE
// (default .secrets/ezyvet-tags/catalog-<date>.json) and a summary on stdout.
//
// Run: set -a; source .secrets/ezyvet.env; set +a; node agent/ezyvet/list-tags.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { openEzyvet } from "./session.mjs";
import { switchDepartment, ROOT_DEPARTMENT } from "./report-center.mjs";
import { openRecordsTab, setRecordType, addFilterRow, filterField } from "./records-dashboard.mjs";

const LIMIT = Number(process.env.TAG_LIMIT ?? 20000);
const MAX_QUERIES = 1500;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 *$()-/&'.".split("");
const today = new Date().toISOString().slice(0, 10);
const OUT_FILE = process.env.OUT_FILE || `.secrets/ezyvet-tags/catalog-${today}.json`;
const log = (m) => console.log(`[tag-catalog] ${m}`);

/** Split ezyVet's "Title(Group)" label using the known title. */
export function parseTagItem(id, title, label) {
  const rest = label.startsWith(title) ? label.slice(title.length).trim() : "";
  const group = rest.startsWith("(") && rest.endsWith(")") ? rest.slice(1, -1) : rest || null;
  return { id: Number(id), title, group };
}

/**
 * Type into a filter row's tag search box and capture the DropDownList request
 * it sends (url + form body), so it can be replayed with any search term.
 */
async function captureSearch(page, rowIndex) {
  const box = page
    .locator(`select[name="${filterField(rowIndex, "Type")}"]`)
    .locator("xpath=ancestor::div[contains(@class,'filterRow')][1]")
    .locator("input.dropDownField")
    .first();
  let onReq;
  const captured = new Promise((resolve) => {
    onReq = (req) => {
      if (/\/General\/DropDownList/.test(req.url()) && /dropdownClass=TagName/.test(req.postData() ?? "")) {
        resolve({ url: req.url(), post: req.postData() });
      }
    };
    page.on("request", onReq);
  });
  try {
    await box.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("a", { delay: 100 });
    const t = await Promise.race([captured, page.waitForTimeout(15000).then(() => null)]);
    if (!t) throw new Error(`row ${rowIndex}: the tag search box sent no DropDownList request`);
    return t;
  } finally {
    page.off("request", onReq);
    await page.keyboard.press("Escape").catch(() => {});
  }
}

/** Replay the captured request with a different search term and limit. */
async function search(page, template, term) {
  const params = new URLSearchParams(template.post);
  params.set("search", term);
  const opts = JSON.parse(params.get("dropDownOptions") ?? "{}");
  opts.dropDownLimit = String(LIMIT);
  params.set("dropDownOptions", JSON.stringify(opts));
  const html = await page.evaluate(
    async ({ url, body }) => {
      const r = await fetch(url, {
        method: "POST",
        body,
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      if (!r.ok) throw new Error(`DropDownList HTTP ${r.status}`);
      return r.text();
    },
    { url: template.url, body: params.toString() },
  );
  const items = await page.evaluate((h) => {
    const doc = new DOMParser().parseFromString(h, "text/html");
    return [...doc.querySelectorAll("a.dropDownListItem")]
      .map((a) => ({
        id: a.getAttribute("data-record-id"),
        title: a.getAttribute("data-record-title") ?? "",
        label: a.querySelector("span")?.textContent?.trim() ?? "",
      }))
      .filter((x) => x.id && x.id !== "0");
  }, html);
  return items.map((x) => parseTagItem(x.id, x.title, x.label));
}

/** Every tag one search box offers: empty search, raised limit, expand if full. */
async function listAll(page, template) {
  const byId = new Map();
  const all = await search(page, template, "");
  all.forEach((t) => byId.set(t.id, t));
  if (all.length < LIMIT) return { tags: [...byId.values()], complete: true };
  const queue = [...ALPHABET];
  let queries = 0;
  while (queue.length && queries < MAX_QUERIES) {
    const term = queue.shift();
    const found = await search(page, template, term);
    queries += 1;
    found.forEach((t) => byId.set(t.id, t));
    if (found.length >= LIMIT && term.length < 6) for (const c of ALPHABET) queue.push(term + c);
  }
  return { tags: [...byId.values()], complete: queue.length === 0 };
}

async function main() {
  const session = await openEzyvet({ headless: true, blockAssets: true, log });
  const { page } = session;
  const byKey = new Map();
  const incomplete = [];
  const add = (source, tags) => {
    for (const t of tags) {
      const key = `${t.id}`;
      const prev = byKey.get(key);
      byKey.set(key, { ...t, sources: [...new Set([...(prev?.sources ?? []), source])] });
    }
  };
  try {
    await switchDepartment(page, ROOT_DEPARTMENT, log);
    await openRecordsTab(page, log);
    await setRecordType(page, "Contact", log);
    await addFilterRow(page, 0);
    const typeSel = `select[name="${filterField(1, "Type")}"]`;

    await page.selectOption(typeSel, "AnimalTag");
    await page.waitForTimeout(3000);
    const pet = await listAll(page, await captureSearch(page, 1));
    add("Pet Tag", pet.tags);
    if (!pet.complete) incomplete.push("Pet Tag");
    log(`Pet Tag: ${pet.tags.length}`);

    // Tag groups: every option whose value is "Tag" — Breed, plus the
    // "-----Tags-----" section (General, Species, Master Problem, …).
    const groups = await page.evaluate((s) =>
      [...document.querySelector(s).options]
        .map((o, index) => ({ index, value: o.value, text: o.text.trim() }))
        .filter((o) => o.value === "Tag" && o.text),
    typeSel);
    log(`${groups.length} tag group(s)`);
    for (const g of groups) {
      try {
        await page.selectOption(typeSel, { index: g.index });
        await page.waitForTimeout(3000);
        const res = await listAll(page, await captureSearch(page, 1));
        add(`Group: ${g.text}`, res.tags);
        if (!res.complete) incomplete.push(g.text);
        log(`group "${g.text}": ${res.tags.length}`);
      } catch (e) {
        incomplete.push(g.text);
        log(`group "${g.text}": ERROR ${e?.message ?? e}`);
      }
    }

    const tags = [...byKey.values()].sort(
      (a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.title.localeCompare(b.title),
    );
    mkdirSync(dirname(OUT_FILE), { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify({ listed_on: today, incomplete, tags }, null, 2));
    const counts = new Map();
    for (const t of tags) counts.set(t.group ?? "(none)", (counts.get(t.group ?? "(none)") ?? 0) + 1);
    log(`${tags.length} tag(s) in ${counts.size} group(s) → ${OUT_FILE}`);
    for (const [g, n] of counts) log(`  ${g}: ${n}`);
    if (incomplete.length) {
      log(`INCOMPLETE: ${incomplete.join(", ")}`);
      process.exitCode = 1;
    }
  } catch (err) {
    log(`ERROR: ${err?.message ?? err}`);
    process.exitCode = 1;
  } finally {
    await session.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
