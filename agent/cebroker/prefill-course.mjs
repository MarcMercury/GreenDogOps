// Semi-automated CE Broker "New Course" pre-fill (HEADED, human-in-the-loop).
//
// Reads a submission package JSON (exported from the app's "Submit to CE Broker"
// panel → "Download package"), opens the provider New Course wizard, and
// best-effort pre-fills the text fields by fuzzy-matching labels/placeholders.
// It then PAUSES with the browser open so you can: pick any dropdowns it
// couldn't map, upload the attachments, review, and click Finish yourself.
// It NEVER submits.
//
// Usage:
//   set -a; source .secrets/cebroker.env; set +a
//   node agent/cebroker/prefill-course.mjs .secrets/cebroker-package.json
//
// ⚠️ Selectors are best-effort until agent/cebroker/explore.mjs has mapped the
// real wizard DOM; tighten fillByKeywords() with the confirmed selectors.
import { openCebroker } from "./session.mjs";
import { readFileSync } from "node:fs";

/** Map of package field → keywords we look for in a field's label/name. */
const FIELD_KEYWORDS = {
  name: ["course name", "course title", "title"],
  subject: ["subject"],
  ceHoursTotal: ["hours", "credit hours", "number of hours"],
  location: ["location", "venue"],
  trackingNumber: ["tracking", "race number", "approval number"],
  presenters: ["instructor", "presenter", "speaker"],
  description: ["description", "summary"],
  objectives: ["objective", "learning"],
};

async function fillByKeywords(page, key, value) {
  if (value == null || value === "") return false;
  const keywords = FIELD_KEYWORDS[key] ?? [];
  const inputs = await page.$$("input, textarea");
  for (const el of inputs) {
    const visible = await el.isVisible().catch(() => false);
    if (!visible) continue;
    const meta = (
      (await el.getAttribute("name")) +
      " " +
      (await el.getAttribute("id")) +
      " " +
      (await el.getAttribute("placeholder")) +
      " " +
      (await el.getAttribute("aria-label"))
    ).toLowerCase();
    if (keywords.some((k) => meta.includes(k))) {
      await el.fill(String(value)).catch(() => {});
      return true;
    }
  }
  return false;
}

async function main() {
  const pkgPath = process.argv[2] ?? ".secrets/cebroker-package.json";
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const log = (m) => console.log(`[cebroker:prefill] ${m}`);

  const { page, close } = await openCebroker({ headless: false, log });

  // Navigate to Courses → + New Course.
  const courses = page.locator('a:has-text("Courses"), button:has-text("Courses")').first();
  if (await courses.count().catch(() => 0)) {
    await courses.click().catch(() => {});
    await page.waitForTimeout(4000);
  }
  const newCourse = page
    .locator('a:has-text("New Course"), button:has-text("New Course")')
    .first();
  if (await newCourse.count().catch(() => 0)) {
    await newCourse.click().catch(() => {});
    await page.waitForTimeout(4000);
  }

  // Best-effort pre-fill of whatever is on the current step.
  const filled = [];
  for (const key of Object.keys(FIELD_KEYWORDS)) {
    if (await fillByKeywords(page, key, pkg[key])) filled.push(key);
  }
  log(`pre-filled: ${filled.join(", ") || "(nothing matched on this step)"}`);

  console.log("\n--- SUBMISSION PACKAGE (for the fields/dropdowns to set by hand) ---");
  for (const [k, v] of Object.entries(pkg)) {
    if (k === "documents") continue;
    console.log(`${k}: ${v ?? "—"}`);
  }
  if (Array.isArray(pkg.documents) && pkg.documents.length) {
    console.log("\nAttachments to upload:");
    for (const d of pkg.documents) console.log(`- ${d.kind}: ${d.label || d.url} (${d.url})`);
  }

  log(
    "browser left OPEN. Advance the wizard, set dropdowns, upload attachments, then click Finish yourself. Close the window when done.",
  );
  // Keep the process alive until the browser is closed manually.
  await page.waitForEvent("close", { timeout: 0 }).catch(() => {});
  await close().catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
