// One-off probe: open the ezyVet "Animals" report, dump its parameter form,
// run it as CSV and print the header + a couple of sample rows so we can build
// the ingest schema. Usage:
//   set -a; source .secrets/ezyvet.env; set +a; node agent/ezyvet/probe-animals.mjs
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEzyvet } from "./session.mjs";
import { openReporting, openReport, runCsvReport } from "./report-center.mjs";

const NAME = process.argv[2] || "Animals";
const log = (m) => console.log(`[probe] ${m}`);

function splitCsvLine(line) {
  const out = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

const session = await openEzyvet({ locationKey: "sherman_oaks", log });
const page = session.page;
try {
  await openReporting(page, log);
  await openReport(page, NAME, log);

  const form = await page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    const inputs = Array.from(document.querySelectorAll("input, select"))
      .filter(vis)
      .map((e) => ({ tag: e.tagName, type: e.type, name: e.name, id: e.id, value: (e.value || "").slice(0, 30) }));
    const labels = Array.from(document.querySelectorAll("label, legend"))
      .filter(vis)
      .map((e) => (e.innerText || "").trim())
      .filter(Boolean);
    return { inputs: inputs.slice(0, 60), labels: labels.slice(0, 40) };
  });
  console.log("LABELS:", JSON.stringify(form.labels));
  console.log("INPUTS:", JSON.stringify(form.inputs, null, 1));

  const dir = mkdtempSync(join(tmpdir(), "ezyvet-probe-"));
  const out = join(dir, "animals.csv");
  await runCsvReport(page, { name: NAME, downloadPath: out, log });
  const text = readFileSync(out, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  console.log(`\nLINES: ${lines.length}  BYTES: ${text.length}`);
  const header = splitCsvLine(lines[0]);
  console.log("HEADER:", JSON.stringify(header, null, 1));
  for (const l of lines.slice(1, 3)) {
    const cells = splitCsvLine(l);
    console.log("SAMPLE:", JSON.stringify(Object.fromEntries(header.map((h, i) => [h, cells[i]]))));
  }
} catch (err) {
  console.log("ERROR:", err?.message ?? String(err));
  await page.screenshot({ path: ".secrets/ezyvet-probe/animals-error.png", fullPage: true }).catch(() => {});
} finally {
  await session.close?.();
}
