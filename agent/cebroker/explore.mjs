// One-off CE Broker provider portal explorer (read-only, HEADED).
//
// Logs in (you solve any CAPTCHA/MFA in the visible window), saves the session,
// and dumps the DOM structure we need to tighten the automation: the top-level
// nav, the Courses tab, and the "+ New Course" wizard's first fields. Writes
// screenshots + a JSON map to .secrets/cebroker-probe/. Does NOT submit anything.
//
// Usage:
//   set -a; source .secrets/cebroker.env; set +a
//   node agent/cebroker/explore.mjs
import { openCebroker } from "./session.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = ".secrets/cebroker-probe";

async function dump(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});
}

async function visibleAnchors(page) {
  return page
    .$$eval("a, button", (els) =>
      els
        .filter((e) => e.offsetParent !== null)
        .map((e) => (e.textContent || "").trim())
        .filter((t) => t && t.length < 40),
    )
    .catch(() => []);
}

async function visibleInputs(page) {
  return page
    .$$eval("input, select, textarea", (els) =>
      els
        .filter((e) => e.offsetParent !== null)
        .map((e) => ({
          tag: e.tagName.toLowerCase(),
          type: e.getAttribute("type"),
          name: e.getAttribute("name"),
          id: e.getAttribute("id"),
          placeholder: e.getAttribute("placeholder"),
          label:
            (e.getAttribute("aria-label") ||
              e.closest("label")?.textContent ||
              "").trim().slice(0, 60),
        })),
    )
    .catch(() => []);
}

async function main() {
  const log = (m) => console.log(`[cebroker:explore] ${m}`);
  const { page, close } = await openCebroker({ headless: false, log });

  const map = { url: page.url(), steps: {} };

  log("dashboard loaded");
  await page.waitForTimeout(3000);
  await dump(page, "10-dashboard");
  map.steps.dashboard = {
    url: page.url(),
    nav: await visibleAnchors(page),
  };

  // Try to reach the Courses tab.
  const courses = page
    .locator('a:has-text("Courses"), button:has-text("Courses")')
    .first();
  if (await courses.count().catch(() => 0)) {
    log("opening Courses");
    await courses.click().catch(() => {});
    await page.waitForTimeout(4000);
    await dump(page, "20-courses");
    map.steps.courses = { url: page.url(), controls: await visibleAnchors(page) };

    // Try to open the New Course wizard (read-only peek at the first step).
    const newCourse = page
      .locator('a:has-text("New Course"), button:has-text("New Course")')
      .first();
    if (await newCourse.count().catch(() => 0)) {
      log("opening + New Course");
      await newCourse.click().catch(() => {});
      await page.waitForTimeout(4000);
      await dump(page, "30-new-course");
      map.steps.newCourse = {
        url: page.url(),
        inputs: await visibleInputs(page),
      };
    } else {
      log("could not find a '+ New Course' control");
    }
  } else {
    log("could not find a 'Courses' nav item — check 10-dashboard.png");
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/dom-map.json`, JSON.stringify(map, null, 2));
  log(`wrote ${OUT}/dom-map.json + screenshots`);
  log("leaving browser open 20s so you can look around…");
  await page.waitForTimeout(20000);
  await close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
