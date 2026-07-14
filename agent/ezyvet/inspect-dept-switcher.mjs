// Inspect the program-level department switcher: open the modal via the header
// location block, then examine the "Select Department" dropdown + its options.
import { openEzyvet } from "./session.mjs";

const log = (m) => console.log(`[i] ${m}`);
const session = await openEzyvet({ log });
const page = session.page;
const OUT = ".secrets/ezyvet-probe";

try {
  // Open the modal by clicking the header location block (upper-left).
  const openers = [
    page.getByText(/GDD & MPMV/i).first(),
    page.getByText(/Sherman Oaks - Invent/i).first(),
    page.getByText(/Green Dog - Sherman Oaks/i).first(),
  ];
  let opened = false;
  for (const o of openers) {
    if ((await o.count()) && (await o.isVisible().catch(() => false))) {
      await o.click().catch(() => {});
      const title = page.getByText("Change department or inventory location", { exact: false });
      if (await title.count().then((c) => c > 0).catch(() => false)) {
        try { await title.waitFor({ state: "visible", timeout: 6000 }); opened = true; break; } catch { /* try next */ }
      }
    }
  }
  console.log("modal opened:", opened);
  await page.screenshot({ path: `${OUT}/70-modal.png` });

  // Inspect the Select Department field.
  const fields = await page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    const labelNode = Array.from(document.querySelectorAll("*")).find(
      (e) => vis(e) && e.children.length === 0 && /Select Department/i.test(e.textContent || ""),
    );
    let deptInput = null;
    if (labelNode) {
      let n = labelNode.parentElement;
      for (let i = 0; i < 4 && n && !deptInput; i++) { deptInput = n.querySelector("input"); n = n.parentElement; }
    }
    return {
      deptInput: deptInput ? { id: deptInput.id, name: deptInput.name, cls: (deptInput.className || "").slice(0, 60), val: deptInput.value } : null,
      allModalInputs: Array.from(document.querySelectorAll("input")).filter(vis).map((e) => ({ id: e.id, name: e.name, cls: (e.className || "").slice(0, 50), val: (e.value || "").slice(0, 40) })).slice(0, 12),
    };
  });
  console.log("fields:", JSON.stringify(fields, null, 2));

  // Type into the Select Department field and dump the option list that appears.
  if (fields.deptInput) {
    const sel = fields.deptInput.id ? `#${fields.deptInput.id}` : `input[name="${fields.deptInput.name}"]`;
    const inp = page.locator(sel).first();
    await inp.click();
    await inp.fill("");
    await inp.pressSequentially("Van Nuys", { delay: 50 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/71-dept-typed.png` });
    const options = await page.evaluate(() => {
      const vis = (e) => e.offsetParent !== null;
      // ezyVet dropDown options usually render in a floating list.
      const lists = Array.from(document.querySelectorAll("li, .dropDownItem, [class*='dropdown' i] *, [class*='option' i], ul *, .results *"));
      return [...new Set(lists.filter(vis).map((e) => (e.textContent || "").trim()).filter((t) => t && t.length < 60 && /van nuys|sherman|venice|green dog|gdd|mpmv/i.test(t)))].slice(0, 20);
    });
    console.log("dropdown options after typing 'Van Nuys':", JSON.stringify(options, null, 2));
  }
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
  await page.screenshot({ path: `${OUT}/7x-error.png`, fullPage: true }).catch(() => {});
} finally {
  await session.close();
}
