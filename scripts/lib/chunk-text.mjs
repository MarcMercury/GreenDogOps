/**
 * Shared text chunker for the Resources full-text index
 * (greendogops.resource_document_chunk, migration 0174).
 *
 * Used by ingest_google_docs.mjs and ingest_resource_pdfs.mjs so a Google Doc
 * and an uploaded PDF are indexed the same way.
 */
const CHUNK_CHARS = 1500;
const CHUNK_OVERLAP = 200;

/** .docx and PDF text often has no blank lines, so fall back to single lines. */
const SEPARATORS = [/\n\s*\n/, /\n/];

function splitToSize(text, level = 0) {
  const pieces = [];
  const parts = level < SEPARATORS.length ? text.split(SEPARATORS[level]) : [text];
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    if (t.length <= CHUNK_CHARS) {
      pieces.push(t);
    } else if (level < SEPARATORS.length) {
      pieces.push(...splitToSize(t, level + 1));
    } else {
      for (let i = 0; i < t.length; i += CHUNK_CHARS) {
        pieces.push(t.slice(i, i + CHUNK_CHARS));
      }
    }
  }
  return pieces;
}

/** Pack paragraphs up to CHUNK_CHARS, carrying a little overlap for context. */
export function chunkText(text) {
  const chunks = [];
  let buf = "";
  for (const p of splitToSize(text)) {
    if (buf && buf.length + p.length + 2 > CHUNK_CHARS) {
      chunks.push(buf);
      buf = buf.slice(-CHUNK_OVERLAP);
    }
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf.trim()) chunks.push(buf);
  return chunks;
}

export const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Dollar-quote document text so apostrophes and newlines survive untouched. */
export function dollarQuote(s) {
  let tag = "$doc$";
  for (let i = 1; s.includes(tag); i++) tag = `$doc${i}$`;
  return `${tag}${s}${tag}`;
}
