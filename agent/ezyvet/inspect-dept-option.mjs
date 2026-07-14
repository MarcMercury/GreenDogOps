// Dump the clickable ancestor chain of a department dropdown option.
import { openEzyvet } from "./session.mjs";

const session = await openEzyvet({ log: () => {} });
const page = session.page;
try {
  for (const re of [/GDD & MPMV/i, /Sherman Oaks - Invent/i]) {
    const o = page.getByText(re).first();
    if ((await o.count()) && (await o.isVisible().catch(() => false))) {
      await o.click().catch(() => {});
      try { await page.getByText("Change department or inventory location", { exact: false }).waitFor({ state: "visible", timeout: 5000 }); break; } catch { /* next */ }
    }
  }
  const dept = page.locator('xpath=//*[normalize-space(text())="Select Department"]/following::input[1]').first();
  await dept.click();
  await dept.fill("");
  await dept.pressSequentially("Van Nuys", { delay: 60 });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    const span = Array.from(document.querySelectorAll("*")).find(
      (e) => vis(e) && e.children.length === 0 && /green dog - van nuys/i.test(e.textContent || ""),
    );
    if (!span) return { found: false };
    const chain = [];
    let n = span;
    for (let i = 0; i < 6 && n; i++) {
      chain.push({
        tag: n.tagName,
        cls: (n.className || "").toString().slice(0, 60),
        role: n.getAttribute ? n.getAttribute("role") : null,
        hasClick: typeof n.onclick === "function",
      });
      n = n.parentElement;
    }
    return { found: true, chain };
  });
  console.log(JSON.stringify(info, null, 2));
} catch (e) {
  console.log("ERR", e?.message ?? e);
} finally {
  await session.close();
}
