// Experiment: drive the Select Department dropdown to switch clinics, and
// discover how the option list renders so we can scope the click.
import { openEzyvet } from "./session.mjs";

const log = (m) => console.log(`[x] ${m}`);
const session = await openEzyvet({ log });
const page = session.page;
const OUT = ".secrets/ezyvet-probe";

async function openModal() {
  for (const re of [/GDD & MPMV/i, /Sherman Oaks - Invent/i, /Van Nuys - Invent/i, /Venice - Invent/i, /Green Dog - (Sherman Oaks|Van Nuys|Venice)/i]) {
    const o = page.getByText(re).first();
    if ((await o.count()) && (await o.isVisible().catch(() => false))) {
      await o.click().catch(() => {});
      const title = page.getByText("Change department or inventory location", { exact: false });
      try { await title.waitFor({ state: "visible", timeout: 5000 }); return true; } catch { /* next */ }
    }
  }
  return false;
}

try {
  log(`opened modal: ${await openModal()}`);
  const dept = page.locator('xpath=//*[normalize-space(text())="Select Department"]/following::input[1]').first();
  await dept.click();
  await dept.fill("");
  await dept.pressSequentially("Van Nuys", { delay: 60 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/72-dept-vannuys.png` });

  // Dump every visible node containing "Van Nuys" with tag+class+a stable path.
  const hits = await page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    return Array.from(document.querySelectorAll("*"))
      .filter((e) => vis(e) && e.children.length === 0 && /green dog - van nuys/i.test(e.textContent || ""))
      .map((e) => ({ tag: e.tagName, cls: (e.className || "").toString().slice(0, 60), text: (e.textContent || "").trim().slice(0, 50),
        parentCls: (e.parentElement?.className || "").toString().slice(0, 60) }))
      .slice(0, 20);
  });
  console.log("van nuys nodes:", JSON.stringify(hits, null, 2));
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
  await page.screenshot({ path: `${OUT}/7x-error.png`, fullPage: true }).catch(() => {});
} finally {
  await session.close();
}
