#!/usr/bin/env node
/**
 * Convert the Resources library's Google Docs into native Ops documents
 * (migration 0235): editable in Ops, access-controlled, versioned, signable.
 *
 *   node scripts/import_google_docs_native.mjs            # dry run: convert, compare, write .data/gdoc-native/
 *   node scripts/import_google_docs_native.mjs --apply    # write to the database in NEXT_PUBLIC_SUPABASE_URL
 *   node scripts/import_google_docs_native.mjs --apply --refresh   # re-import (adds a new version)
 *
 * For every Google source below:
 *   - the existing link-only row (google_file_id) becomes the native document,
 *     taking the title/category/description/order of the PDF copy it replaces;
 *     a Doc with no link row gets a new row;
 *   - the PDF copy (and nothing else) is hidden: is_active = false and
 *     superseded_by = the native row, so old links redirect and nothing is deleted;
 *   - version 1 is recorded and the Ask Ziggy chunks are rebuilt from the new text;
 *   - links between converted Docs are rewritten to their /resources/doc/<id> page.
 *
 * Idempotent: a row that is already native is skipped unless --refresh.
 * Point it at staging by exporting NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY for that project first.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { ROOT, env } from "./lib/google-auth.mjs";
import { DOC_MIME, DOCX_MIME, docText, openFile } from "./lib/google-docs.mjs";
import { chunkText } from "../src/lib/resources/chunk-text.ts";
import { MAX_IMAGE_BYTES, documentText, sanitizeDocument } from "../src/lib/resources/content.ts";
import {
  docxImageTargets,
  docxToTiptap,
  googleDocImages,
  googleDocToTiptap,
} from "../src/lib/resources/doc-import.ts";

const APPLY = process.argv.includes("--apply");
const REFRESH = process.argv.includes("--refresh");
const OUT_DIR = path.join(ROOT, ".data", "gdoc-native");

/**
 * Google file → where it lands. `twin` is the storage_path of the PDF copy the
 * native document replaces; its metadata wins. Without a twin, `meta` is used.
 */
const SOURCES = [
  { id: "1OeZxk5pEDc4oHQxW0-QcCm41h2E-t9AWA4G_OQIV5pA", twin: "gdd-roles.pdf" },
  { id: "12QrK1R-9QXiAx-nhuITHY-G6nmphEbbf1k6XarXYGX8", twin: "gdd-core-attributes.pdf" },
  { id: "1p9t2Pzpp7CkeayTM8H9FS5CBE-LoJ7s8c2U8KgrLOlU", twin: "gdd-compensation-overview.pdf" },
  { id: "1brfUtwLOMU14MFx_25-sfrgbGvVOX2X27D9-ZnJuxTE", twin: "gdd-review-process.pdf" },
  { id: "1QoMgpOhzGwVCjM6NiC4E1MaahDGhyORmHzCYX5Rd-Ps", twin: "employee-pet-policy.pdf" },
  { id: "1J8nq-cy3eWrOuixB8dMRJzxa7xiWrIKXu39Rgc7yuJM", twin: "gdd-pto-sick-time-unpaid-time-off-policy.pdf" },
  { id: "1LxdmlY1mS4e8xzzO0KOtnieOYqJt4BbAJcZTC34JQ7Y", twin: "gdd-harassment-policy.pdf" },
  { id: "1q9JjdcQnsA8lHQlWGjQyg0I2z7TqWw5h", twin: "gdd-respectful-workplace-policy-docx.pdf" },
  { id: "1RnIB7gLo_BdHgAj-79r8W1DFSF5jMdGEaCxcx8PfYW8", twin: "gdd-continuing-education-policy.pdf" },
  { id: "19CZDbS73rDokbLlu2iGc1-VfAm4cYzcK", twin: "green-dog-attendance-policy-docx.pdf" },
  { id: "1oVnI1U_sgFZ9Y54TzQevoLLliuK8TCzGQsAjCPyzgxc", twin: "non-employee-pet-discounts.pdf" },
  { id: "1-WESyPVBW8Jt-oZCR7-qpdKtdVl-9oz31uynSC_w8KQ", twin: "workplace-relationships-policy.pdf" },
  { id: "10WHDG-7kplVDYcQa4MDfLLZqsJHeyQF1", twin: "green-dog-safety-and-best-practice-handbook-docx.pdf" },
  { id: "1_pqe4NlBTIy3ZYS1Y5obP_vAZfu-oWjnIJEnS9v8OKQ", twin: "gdd-urgent-care-locations-and-injury-protocol.pdf" },
  { id: "1G-rfxGC2zsEFShFeSen7CsbqjUAAy_Cn", twin: "gdd-pregnancy-safety-docx.pdf" },
  { id: "1qbre_4ymIMle3lf7pg1Tr87r3ULZ8ZN9", twin: "safety-hazard-report-form-docx.pdf" },
  { id: "1wPGAkIIYtlO3l828t0otwWLsRgaibFtTu9Ff_DPxgWI", twin: "safety/gdoc-1wPGAkIIYtlO3l828t0otwWLsRgaibFtTu9Ff_DPxgWI.pdf" },
  { id: "1tMG9xY0b3ulhWXYuAblmA3UZy9Uzcsa8tk6QSKdrfHs", twin: "safety/gdoc-1tMG9xY0b3ulhWXYuAblmA3UZy9Uzcsa8tk6QSKdrfHs.pdf" },
  {
    id: "1OERyRhaB-_e70jWw4pYGsUrbeje1GP1m",
    meta: { title: "Disciplinary Policy", category: "hr", sort_order: 36, description: "Progressive discipline steps and expectations." },
  },
  {
    id: "1cU2bH6OM0AlWb-w-tb-6-HXih2U9ZpiuDPHAV4LVzT8",
    meta: { title: "Employee Wellness", category: "hr", sort_order: 37, description: "Wellness resources and support for employees." },
  },
  {
    id: "1KlNfP8ECwHZItWOJh2wq3zkJF7fq-YhF2G-v7rqQQZk",
    meta: { title: "Important Links for All Employees", category: "hr", sort_order: 6, description: "Index of the company policies and key links." },
  },
  {
    id: "1GGfK3PVYb6thhdS6cpNyeji6jiv0Hg4tMvaoysYbdiY",
    meta: { title: "Covid Protocol (old notes)", category: "hr", sort_order: 90, description: "Archived Covid update notes." },
  },
];

/** A policy link that could not be converted (no connected account can open it). */
const LINK_ONLY = [
  {
    title: "GDD Master Protocols Sheet",
    source_url: "https://docs.google.com/document/d/1m_b6JW0ORuDbWrD_3i9jdLKGKpw1Lt02Odyan3fX5tI/edit",
    category: "hr",
    sort_order: 7,
    description: "Master protocols document (Google Docs).",
  },
];

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
const IMAGE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false }, db: { schema: "greendogops" } });
console.error(`${APPLY ? "APPLY" : "DRY RUN"} against ${new URL(url).host}${REFRESH ? " (refresh)" : ""}`);

const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};

function toDataUrl(buf, mime) {
  if (!mime || buf.length > MAX_IMAGE_BYTES) return null;
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Fetch with a timeout and two retries on network/5xx errors. */
async function fetchBytes(href) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(href, { signal: AbortSignal.timeout(30_000) });
      if (res.status >= 500 && attempt < 3) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null;
      return { buf: Buffer.from(await res.arrayBuffer()), mime: (res.headers.get("content-type") ?? "").split(";")[0] };
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/** Google Doc or uploaded .docx → { doc, plain, stats }. */
async function convert(fileId, rewriteLink) {
  const { meta, auth } = await openFile(fileId);
  const stats = { images: 0, skippedImages: 0 };
  if (meta.mimeType === DOC_MIME) {
    const { data } = await google.docs({ version: "v1", auth }).documents.get({ documentId: fileId, includeTabsContent: true });
    const images = new Map();
    for (const img of googleDocImages(data)) {
      const got = await fetchBytes(img.url);
      const src = got && /^image\/(png|jpeg|gif|webp)$/.test(got.mime) ? toDataUrl(got.buf, got.mime) : null;
      if (src) {
        images.set(img.id, src);
        stats.images++;
      } else stats.skippedImages++;
    }
    const doc = googleDocToTiptap(data, { imageSrc: (id) => images.get(id) ?? null, rewriteLink });
    const tab = data.tabs?.[0]?.documentTab ?? data;
    // docText() writes links as [label](url); compare visible words only.
    const plain = docText(tab.body?.content).join("").replace(/\]\([^)]*\)/g, "]");
    return { meta, doc, plain, stats };
  }
  if (meta.mimeType === DOCX_MIME) {
    const { data } = await google.drive({ version: "v3", auth }).files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    const tmp = path.join(os.tmpdir(), `${fileId}.docx`);
    fs.writeFileSync(tmp, Buffer.from(data));
    try {
      const part = (name) => {
        try {
          return execFileSync("unzip", ["-p", tmp, name], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        } catch {
          return undefined;
        }
      };
      const parts = {
        document: part("word/document.xml"),
        rels: part("word/_rels/document.xml.rels"),
        numbering: part("word/numbering.xml"),
        styles: part("word/styles.xml"),
      };
      if (!parts.document) throw new Error("not a readable .docx");
      const images = new Map();
      for (const target of docxImageTargets(parts)) {
        const ext = target.split(".").pop()?.toLowerCase() ?? "";
        const buf = execFileSync("unzip", ["-p", tmp, `word/${target.replace(/^\/?word\//, "")}`], { maxBuffer: 64 * 1024 * 1024 });
        const src = toDataUrl(buf, IMAGE_MIME[ext]);
        if (src) {
          images.set(target, src);
          stats.images++;
        } else stats.skippedImages++;
      }
      const doc = docxToTiptap(parts, { imageSrc: (t) => images.get(t) ?? null, rewriteLink });
      const plain = parts.document
        .replace(/<w:p[ >]/g, "\n<w:p ")
        .replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, "")
        .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      return { meta, doc, plain, stats };
    } finally {
      fs.unlinkSync(tmp);
    }
  }
  throw new Error(`unsupported file type ${meta.mimeType}`);
}

/** Share of the source's words that survived the conversion (order-insensitive). */
function coverage(source, converted) {
  const words = (s) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const have = new Map();
  for (const w of words(converted)) have.set(w, (have.get(w) ?? 0) + 1);
  const src = words(source);
  let kept = 0;
  for (const w of src) {
    const n = have.get(w) ?? 0;
    if (n > 0) {
      kept++;
      have.set(w, n - 1);
    }
  }
  return src.length ? kept / src.length : 1;
}

// ---------------------------------------------------------------------------

const rows = must(
  await db
    .from("resource_document")
    .select("id, title, category, description, sort_order, staff_only, storage_path, source_url, google_file_id, content_json, current_version, is_active, superseded_by"),
  "load documents",
);
const byGoogle = new Map(rows.filter((r) => r.google_file_id).map((r) => [r.google_file_id, r]));
const byPath = new Map(rows.filter((r) => r.storage_path).map((r) => [r.storage_path, r]));

// Pass 1: the row each source lands in (created on --apply when missing).
const plan = [];
for (const src of SOURCES) {
  const twin = src.twin ? (byPath.get(src.twin) ?? null) : null;
  let target = byGoogle.get(src.id) ?? null;
  if (src.twin && !twin) console.error(`  note: PDF copy ${src.twin} not found — using fallback metadata`);
  const meta = twin
    ? { title: twin.title, category: twin.category, sort_order: twin.sort_order, description: twin.description }
    : (src.meta ?? { title: target?.title ?? src.id, category: "hr", sort_order: 50, description: null });
  if (!target && APPLY) {
    target = must(
      await db
        .from("resource_document")
        .insert({ ...meta, google_file_id: src.id, content_json: EMPTY_DOC, is_active: false })
        .select("id, title, content_json, current_version, google_file_id")
        .single(),
      `create row for ${meta.title}`,
    );
    target.current_version = 0;
    target.created = true;
  }
  plan.push({ src, twin, target, meta });
}

const nativeUrl = new Map(plan.filter((p) => p.target).map((p) => [p.src.id, `/resources/doc/${p.target.id}`]));
const rewriteLink = (href) => {
  const m = /docs\.google\.com\/(?:document|file)\/d\/([a-zA-Z0-9_-]{20,})/.exec(href) ?? /drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]{20,})/.exec(href);
  return (m && nativeUrl.get(m[1])) || href;
};

// Pass 2: convert and write.
fs.mkdirSync(OUT_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const problems = [];
let converted = 0;
let skipped = 0;

for (const p of plan) {
  const label = p.meta.title;
  const alreadyNative = p.target && !p.target.created && p.target.content_json && p.target.current_version > 0;
  if (alreadyNative && !REFRESH) {
    console.error(`skip    ${label} — already native (v${p.target.current_version})`);
    skipped++;
    if (APPLY && p.twin && p.twin.is_active) {
      must(await db.from("resource_document").update({ is_active: false, superseded_by: p.target.id }).eq("id", p.twin.id), "hide twin");
    }
    continue;
  }

  let result;
  try {
    result = await convert(p.src.id, rewriteLink);
  } catch (err) {
    problems.push(`${label}: ${err.message}`);
    console.error(`FAIL    ${label}: ${err.message}`);
    continue;
  }
  const doc = sanitizeDocument(result.doc);
  const text = documentText(doc);
  const cov = coverage(result.plain, text);
  const size = JSON.stringify(doc).length;
  fs.writeFileSync(path.join(OUT_DIR, `${p.src.id}.json`), JSON.stringify(doc, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, `${p.src.id}.txt`), text);
  console.error(
    `${APPLY ? "write" : "ok"}    ${label} — ${text.length} chars, ${result.stats.images} img${result.stats.skippedImages ? ` (+${result.stats.skippedImages} skipped)` : ""}, ${(size / 1024).toFixed(0)} KB, text coverage ${(cov * 100).toFixed(1)}%${p.twin ? ` → replaces ${p.twin.storage_path}` : ""}`,
  );
  if (cov < 0.97) problems.push(`${label}: only ${(cov * 100).toFixed(1)}% of the source words survived`);
  if (!APPLY) continue;

  const version = (p.target.created ? 0 : (p.target.current_version ?? 0)) + 1;
  const sourceUrl = result.meta.webViewLink ?? `https://docs.google.com/document/d/${p.src.id}/edit`;
  must(
    await db.from("resource_document_version").insert({
      document_id: p.target.id,
      version_no: version,
      title: p.meta.title,
      content_json: doc,
      content_text: text,
      change_note: `Imported from Google Docs on ${today} (${sourceUrl})`,
    }),
    `version for ${label}`,
  );
  must(
    await db
      .from("resource_document")
      .update({
        ...p.meta,
        content_json: doc,
        content_text: text,
        source_url: null,
        storage_path: null,
        staff_only: false,
        current_version: version,
        is_active: true,
        content_synced_at: new Date().toISOString(),
      })
      .eq("id", p.target.id),
    `update ${label}`,
  );
  must(await db.from("resource_document_chunk").delete().eq("document_id", p.target.id), "clear chunks");
  const chunks = chunkText(text);
  if (chunks.length) {
    must(
      await db
        .from("resource_document_chunk")
        .insert(chunks.map((content, chunk_index) => ({ document_id: p.target.id, chunk_index, content }))),
      "insert chunks",
    );
  }
  if (p.twin && p.twin.id !== p.target.id) {
    must(
      await db.from("resource_document").update({ is_active: false, superseded_by: p.target.id }).eq("id", p.twin.id),
      `hide ${p.twin.storage_path}`,
    );
  }
  converted++;
}

// Policy links that cannot be converted stay as links.
for (const link of LINK_ONLY) {
  const exists = rows.some((r) => r.source_url === link.source_url) ||
    must(await db.from("resource_document").select("id").eq("source_url", link.source_url), "find link").length > 0;
  if (exists) continue;
  console.error(`${APPLY ? "add" : "would add"}  link ${link.title}`);
  if (APPLY) must(await db.from("resource_document").insert(link), `add ${link.title}`);
}

console.error(`\n${converted} converted, ${skipped} skipped, ${problems.length} problem(s). Output in ${path.relative(ROOT, OUT_DIR)}/`);
for (const p of problems) console.error(`  ! ${p}`);
if (!APPLY) console.error("Dry run — nothing was written. Re-run with --apply.");
process.exit(problems.length ? 1 : 0);
