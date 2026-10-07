// ---------------------------------------------------------------------------
// Best-guess document category (a DOCUMENT_CATEGORY_LABELS key) for a file an
// applicant sent in, from its name. Inbound applications attach resumes, cover
// letters, and the occasional certificate under arbitrary file names; filing
// each under the right category keeps the candidate's Documents tab readable.
// Kept free of server-only imports so it can be unit-tested.
// ---------------------------------------------------------------------------

const RULES: ReadonlyArray<[RegExp, string]> = [
  [/cover[\s_-]*letter|\bcover\b|letter[\s_-]*of[\s_-]*(intent|interest)/i, "cover_letter"],
  [/r[eé]sum[eé]|\bcv\b|curriculum/i, "resume"],
  [/transcript|diploma/i, "transcript"],
  [/reference|recommendation/i, "reference"],
  [/licen[cs]e/i, "license"],
  [/certific|\b(cert|cpr|rvt|cvt)\b/i, "certification"],
];

export function guessDocumentCategory(fileName: string | null | undefined, fallback = "resume"): string {
  // Treat separators as word breaks so "Jane_CV.pdf" matches \bcv\b.
  const name = String(fileName ?? "").replace(/[_.-]+/g, " ");
  for (const [re, category] of RULES) {
    if (re.test(name)) return category;
  }
  return fallback;
}
