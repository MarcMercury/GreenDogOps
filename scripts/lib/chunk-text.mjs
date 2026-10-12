/**
 * Shared text chunker for the Resources full-text index
 * (greendogops.resource_document_chunk, migration 0174).
 *
 * The chunker itself lives in src/lib/resources/chunk-text.ts so the app (native
 * documents) and these scripts (Google Docs, PDFs) index text the same way;
 * Node 24 runs the .ts file directly.
 */
export { chunkText } from "../../src/lib/resources/chunk-text.ts";

export const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Dollar-quote document text so apostrophes and newlines survive untouched. */
export function dollarQuote(s) {
  let tag = "$doc$";
  for (let i = 1; s.includes(tag); i++) tag = `$doc${i}$`;
  return `${tag}${s}${tag}`;
}
