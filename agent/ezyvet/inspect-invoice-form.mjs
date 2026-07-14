// Inspect the Invoice Lines form's date inputs (ids, attributes, siblings).
import { openEzyvet } from "./session.mjs";
import { openReporting, openReport } from "./report-center.mjs";

const log = (m) => console.log(`[i] ${m}`);
const session = await openEzyvet({ log });
try {
  await openReporting(session.page, log);
  await openReport(session.page, "Invoice Lines", log);
  const info = await session.page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    const inputs = Array.from(document.querySelectorAll("input")).filter(vis).map((e, idx) => ({
      idx, type: e.type, name: e.name, id: e.id, cls: (e.className || "").slice(0, 50),
      placeholder: e.placeholder, readonly: e.readOnly, value: (e.value || "").slice(0, 30),
      prevText: (e.previousElementSibling?.innerText || e.closest("*")?.previousElementSibling?.innerText || "").trim().slice(0, 30),
    }));
    // Find labels "From"/"To" and their nearest inputs.
    const labels = Array.from(document.querySelectorAll("*")).filter(
      (e) => vis(e) && /^(From|To)$/.test((e.innerText || "").trim()) && e.children.length === 0,
    ).map((e) => ({
      label: e.innerText.trim(), tag: e.tagName, cls: (e.className || "").slice(0, 40),
      nextInputId: (() => { let n = e.nextElementSibling; for (let i=0;i<4&&n;i++){ const inp=n.querySelector?.("input")||(n.tagName==="INPUT"?n:null); if(inp) return {id:inp.id,cls:(inp.className||"").slice(0,40),val:inp.value}; n=n.nextElementSibling;} return null; })(),
    }));
    return { inputCount: inputs.length, inputs, labels };
  });
  console.log(JSON.stringify(info, null, 2));
} catch (err) {
  console.log("ERR:", err?.message ?? String(err));
} finally {
  await session.close();
}
