/**
 * Fetch the TEXT of a Google Drive file with whichever connected identity can
 * open it. Google Docs come from the Docs API; uploaded .docx files are not
 * Google-native, so the Docs API cannot open them and the bytes are unzipped
 * instead.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { google } from "googleapis";
import { getGoogleAuths } from "./google-auth.mjs";

export const DOC_MIME = "application/vnd.google-apps.document";
export const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Try every connected identity until one can see the file. */
export async function openFile(fileId) {
  const failures = [];
  for (const candidate of getGoogleAuths()) {
    try {
      const { data } = await google
        .drive({ version: "v3", auth: candidate.auth })
        .files.get({
          fileId,
          fields: "id,name,mimeType,modifiedTime,webViewLink",
          supportsAllDrives: true,
        });
      return { meta: data, auth: candidate.auth, mode: candidate.mode };
    } catch (err) {
      const detail = err?.response?.data?.error;
      failures.push(
        `${candidate.mode}: ${detail?.status ?? err?.code} ${detail?.message ?? err?.message ?? ""}`,
      );
    }
  }
  const error = new Error(
    `cannot read ${fileId} with any connected identity:\n  ${failures.join("\n  ")}`,
  );
  error.noAccess = true;
  throw error;
}

/** Flatten Docs API structural elements into text, keeping hyperlink targets. */
export function docText(elements, out = []) {
  for (const el of elements ?? []) {
    for (const run of el.paragraph?.elements ?? []) {
      const content = run.textRun?.content;
      if (!content) continue;
      const url = run.textRun.textStyle?.link?.url;
      out.push(url ? `[${content.trim()}](${url})` : content);
    }
    if (el.paragraph) out.push("");
    for (const row of el.table?.tableRows ?? []) {
      const cells = (row.tableCells ?? []).map((c) =>
        docText(c.content, []).join("").replace(/\s+/g, " ").trim(),
      );
      out.push(`| ${cells.join(" | ")} |`);
    }
  }
  return out;
}

/**
 * Hyperlinks with the label they sit under. In these docs the anchor text is
 * always "Click here", so the useful label is the rest of the paragraph.
 */
export function docLinks(elements, out = []) {
  for (const el of elements ?? []) {
    if (el.paragraph) {
      let label = "";
      let url = null;
      for (const run of el.paragraph.elements ?? []) {
        const content = run.textRun?.content;
        if (!content) continue;
        const href = run.textRun.textStyle?.link?.url;
        if (href) url ??= href;
        else label += content;
      }
      label = label.replace(/[\s\-–:]*click here[\s.]*$/i, "").trim();
      if (url) out.push({ label, url });
    }
    for (const row of el.table?.tableRows ?? []) {
      for (const cell of row.tableCells ?? []) docLinks(cell.content, out);
    }
  }
  return out;
}

async function googleDocText(auth, fileId) {
  const { data } = await google.docs({ version: "v1", auth }).documents.get({
    documentId: fileId,
  });
  return {
    text: docText(data.body?.content).join("").replace(/\n{3,}/g, "\n\n"),
    links: docLinks(data.body?.content),
  };
}

async function docxText(auth, fileId) {
  const { data } = await google.drive({ version: "v3", auth }).files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  const tmp = path.join(os.tmpdir(), `${fileId}.docx`);
  fs.writeFileSync(tmp, Buffer.from(data));
  try {
    const xml = execFileSync("unzip", ["-p", tmp, "word/document.xml"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const text = xml
      .replace(/<w:p[ >]/g, "\n<w:p ")
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { text, links: [] };
  } finally {
    fs.unlinkSync(tmp);
  }
}

/** @returns {{ meta, mode, text: string, links: {label:string,url:string}[] }} */
export async function fetchFileText(fileId) {
  const { meta, auth, mode } = await openFile(fileId);
  if (meta.mimeType === DOC_MIME) {
    return { meta, mode, ...(await googleDocText(auth, fileId)) };
  }
  if (meta.mimeType === DOCX_MIME) {
    return { meta, mode, ...(await docxText(auth, fileId)) };
  }
  const error = new Error(`unsupported mimeType for text: ${meta.mimeType}`);
  error.unsupported = true;
  throw error;
}
