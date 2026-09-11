// One-off Indeed for Employers explorer (READ-ONLY, HEADED).
//
// Run this FIRST. Indeed's employer dashboard DOM is not documented anywhere we
// can rely on, and the big open question is whether your account still has a
// bulk candidate export at all (Indeed has been narrowing candidate-data export
// for years). This probe answers that without changing anything.
//
// Dumps screenshots + a JSON map to .secrets/indeed-probe/. Submits nothing.
//
// Usage (on your own machine, not the dev container):
//   set -a; source .secrets/indeed.env; set +a
//   node agent/indeed/explore.mjs
import { openIndeed, INDEED_CANDIDATES_URL } from "./session.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = ".secrets/indeed-probe";

async function dump(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});
}

async function visibleControls(page) {
  return page
    .$$eval("a, button, [role='button']", (els) =>
      Array.from(
        new Set(
          els
            .filter((e) => e.offsetParent !== null)
            .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
            .filter((t) => t && t.length < 40),
        ),
      ),
    )
    .catch(() => []);
}

/** Anything that smells like an export/download affordance. */
async function exportControls(page) {
  return page
    .$$eval("a, button, [role='button'], [role='menuitem']", (els) =>
      els
        .filter((e) => e.offsetParent !== null)
        .map((e) => ({
          text: (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
          aria: e.getAttribute("aria-label"),
          testid: e.getAttribute("data-testid"),
          href: e.getAttribute("href"),
        }))
        .filter((c) =>
          /export|download|csv|spreadsheet|\.xls/i.test(
            `${c.text} ${c.aria ?? ""} ${c.testid ?? ""} ${c.href ?? ""}`,
          ),
        ),
    )
    .catch(() => []);
}

/**
 * Candidate rows/cards are the other thing we need to identify. Report the
 * repeated-structure candidates so we can pick a stable selector later.
 */
async function repeatedStructures(page) {
  return page
    .$$eval("[data-testid], [class]", (els) => {
      const counts = new Map();
      for (const e of els) {
        if (e.offsetParent === null) continue;
        const key = e.getAttribute("data-testid") || e.className;
        if (typeof key !== "string" || !key || key.length > 80) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .filter(([, n]) => n >= 3 && n <= 200)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([key, n]) => ({ key, count: n }));
    })
    .catch(() => []);
}

async function main() {
  const log = (m) => console.log(`[indeed:explore] ${m}`);
  const { page, close } = await openIndeed({ log });

  const map = { probedAt: new Date().toISOString(), steps: {} };

  log("candidates view");
  await page.goto(INDEED_CANDIDATES_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(6000);
  await dump(page, "10-candidates");
  map.steps.candidates = {
    url: page.url(),
    controls: await visibleControls(page),
    exportControls: await exportControls(page),
    repeated: await repeatedStructures(page),
  };

  log(
    `export-ish controls found on candidates view: ${map.steps.candidates.exportControls.length}`,
  );

  // Overflow menus commonly hide the export. Open the first "more" affordance.
  const more = page
    .locator(
      '[aria-label*="more" i]:visible, [aria-label*="options" i]:visible, button:has-text("More"):visible',
    )
    .first();
  if (await more.count().catch(() => 0)) {
    log("opening overflow menu");
    await more.click().catch(() => {});
    await page.waitForTimeout(2500);
    await dump(page, "20-overflow");
    map.steps.overflow = {
      controls: await visibleControls(page),
      exportControls: await exportControls(page),
    };
    await page.keyboard.press("Escape").catch(() => {});
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/dom-map.json`, JSON.stringify(map, null, 2));
  log(`wrote ${OUT}/dom-map.json + screenshots`);
  log("leaving browser open 60s — click into the candidate list yourself and look for an export.");
  await page.waitForTimeout(60000);
  await close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
