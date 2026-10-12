#!/usr/bin/env node
/**
 * Publish Google Docs to the Resources library as viewable PDFs — the same
 * shape as an in-app upload (a file in the private `resources` bucket plus a
 * resource_document row), so staff can open them without Google access.
 *
 *   node scripts/publish_google_doc_pdfs.mjs --category safety \
 *     "<doc-url>::Title::Description" "<doc-url>" ...              # dry run
 *   node scripts/publish_google_doc_pdfs.mjs ... --apply           # publish
 *   node scripts/ingest_resource_pdfs.mjs --apply                  # index text
 *
 * Title defaults to the Doc's name; Description is optional. Options:
 *   --category <key>   resource_category key (default "general")
 *   --sort <n>         sort_order for new rows (default 50)
 *   --replace          re-export and overwrite the PDF of an already-published
 *                      Doc (then run ingest_resource_pdfs.mjs --all)
 *
 * Each Doc is stored at "<category>/gdoc-<fileId>.pdf", so re-running is
 * idempotent: an already-published Doc is skipped unless --replace is given.
 */
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { env, parseFileId } from "./lib/google-auth.mjs";
import { DOC_MIME, openFile } from "./lib/google-docs.mjs";

const BUCKET = "resources";
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const REPLACE = args.includes("--replace");
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const CATEGORY = opt("--category", "general");
const SORT = Number(opt("--sort", "50"));
const optionValues = new Set([opt("--category"), opt("--sort")]);
const targets = args.filter((a) => !a.startsWith("--") && !optionValues.has(a));

if (!targets.length || !Number.isFinite(SORT)) {
  console.error(
    'usage: node scripts/publish_google_doc_pdfs.mjs [--category key] [--sort n] [--replace] [--apply] "<doc-url>[::Title[::Description]]" ...',
  );
  process.exit(1);
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
const supabase = createClient(url, key, {
  auth: { persistSession: false },
  db: { schema: "greendogops" },
});

const { data: category } = await supabase
  .from("resource_category")
  .select("key")
  .eq("key", CATEGORY)
  .maybeSingle();
if (!category) {
  console.error(`Unknown resource_category "${CATEGORY}".`);
  process.exit(1);
}

let failed = 0;
for (const target of targets) {
  const [ref, titleArg, descArg] = target.split("::").map((s) => s.trim());
  const fileId = parseFileId(ref);
  const storagePath = `${CATEGORY}/gdoc-${fileId}.pdf`;

  try {
    const { meta, auth } = await openFile(fileId);
    if (meta.mimeType !== DOC_MIME) {
      throw new Error(`not a Google Doc (${meta.mimeType})`);
    }
    const title = titleArg || meta.name.trim();

    const { data: existing, error: lookupErr } = await supabase
      .from("resource_document")
      .select("id, title")
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (lookupErr) throw new Error(`lookup failed: ${lookupErr.message}`);
    if (existing && !REPLACE) {
      console.error(`skip  ${title} — already published as "${existing.title}"`);
      continue;
    }

    const res = await google
      .drive({ version: "v3", auth })
      .files.export({ fileId, mimeType: "application/pdf" }, { responseType: "arraybuffer" });
    const pdf = Buffer.from(res.data);
    if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("export did not return a PDF");

    const action = existing ? "replace" : "add";
    console.error(`${action.padEnd(7)} ${title} — ${pdf.length} bytes → ${BUCKET}/${storagePath}`);
    if (!APPLY) continue;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, pdf, { contentType: "application/pdf", upsert: !!existing });
    if (upErr) throw new Error(`upload failed: ${upErr.message}`);

    const row = { file_name: `${meta.name.trim()}.pdf`, size_bytes: pdf.length };
    const { error: dbErr } = existing
      ? await supabase
          .from("resource_document")
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
      : await supabase.from("resource_document").insert({
          ...row,
          title,
          category: CATEGORY,
          description: descArg || null,
          storage_path: storagePath,
          mime_type: "application/pdf",
          staff_only: false,
          sort_order: SORT,
        });
    if (dbErr) {
      // Keep storage and the table in sync, as the in-app upload does.
      if (!existing) await supabase.storage.from(BUCKET).remove([storagePath]);
      throw new Error(`row write failed: ${dbErr.message}`);
    }
  } catch (err) {
    failed++;
    console.error(`FAIL  ${ref}: ${err.message}`);
  }
}

if (!APPLY) console.error("\nDry run — re-run with --apply to publish.");
process.exit(failed ? 1 : 0);
