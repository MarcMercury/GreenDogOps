#!/usr/bin/env node
/**
 * Read any Google Doc or Sheet the connected identities can open.
 *
 *   node scripts/read_google_file.mjs <url-or-id>              # doc text / sheet tabs
 *   node scripts/read_google_file.mjs <url-or-id> "Tab name"   # sheet tab as TSV
 */
import { google } from "googleapis";
import { parseFileId } from "./lib/google-auth.mjs";
import { SHEET_MIME, fetchFileText, openFile } from "./lib/google-docs.mjs";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/read_google_file.mjs <url-or-id> [tab]");
  process.exit(1);
}
const fileId = parseFileId(target);
const tab = process.argv[3];

let opened;
try {
  opened = await openFile(fileId);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const { meta, auth, mode } = opened;
console.error(`# ${meta.name} (${meta.mimeType}) — reading as ${mode}`);

if (meta.mimeType === SHEET_MIME) {
  const sheets = google.sheets({ version: "v4", auth });
  if (!tab) {
    const { data } = await sheets.spreadsheets.get({ spreadsheetId: fileId });
    for (const s of data.sheets ?? []) {
      const p = s.properties;
      console.log(
        `gid=${p.sheetId}\t"${p.title}"\t${p.gridProperties?.rowCount}x${p.gridProperties?.columnCount}`,
      );
    }
  } else {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: fileId,
      range: `'${tab}'`,
    });
    for (const row of data.values ?? []) console.log(row.join("\t"));
  }
} else {
  try {
    const { text } = await fetchFileText(fileId);
    console.log(text);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
