import "server-only";
import { inflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import {
  emptyCandidate,
  candidateHasIdentity,
  type ParsedCandidate,
} from "./import-types";

// ---------------------------------------------------------------------------
// Header mapping — map arbitrary spreadsheet/CSV column names onto our fields.
// ---------------------------------------------------------------------------

type FieldKey =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone_mobile"
  | "target_title"
  | "pipeline"
  | "stage"
  | "source"
  | "score"
  | "notes"
  | "status_notes";

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Ordered alias list: first matching alias (substring or exact) wins.
const HEADER_ALIASES: { field: FieldKey; aliases: string[] }[] = [
  { field: "full_name", aliases: ["full name", "applicant", "candidate", "name"] },
  { field: "first_name", aliases: ["first name", "first", "given name", "fname"] },
  { field: "last_name", aliases: ["last name", "last", "surname", "family name", "lname"] },
  { field: "email", aliases: ["email", "e mail", "email address"] },
  {
    field: "phone_mobile",
    aliases: ["phone", "mobile", "cell", "telephone", "phone number", "contact number"],
  },
  {
    field: "target_title",
    aliases: ["position", "title", "role", "job title", "applying for", "target title", "desired position"],
  },
  { field: "pipeline", aliases: ["pipeline", "department", "team", "group"] },
  { field: "stage", aliases: ["stage", "status", "disposition"] },
  { field: "source", aliases: ["source", "found on", "referral source", "lead source", "applied via"] },
  { field: "score", aliases: ["score", "rating", "grade"] },
  { field: "status_notes", aliases: ["status notes", "status note"] },
  { field: "notes", aliases: ["notes", "note", "comments", "comment", "summary"] },
];

function matchHeader(raw: string): FieldKey | null {
  const norm = normalizeHeader(raw);
  if (!norm) return null;
  // Exact match first.
  for (const { field, aliases } of HEADER_ALIASES) {
    if (aliases.includes(norm)) return field;
  }
  // Substring fallback.
  for (const { field, aliases } of HEADER_ALIASES) {
    if (aliases.some((a) => norm.includes(a))) return field;
  }
  return null;
}

function splitFullName(full: string): { first: string | null; last: string | null } {
  const cleaned = full.replace(/\s+/g, " ").trim();
  if (!cleaned) return { first: null, last: null };
  // "Last, First" convention.
  if (cleaned.includes(",")) {
    const [last, first] = cleaned.split(",", 2).map((s) => s.trim());
    return { first: first || null, last: last || null };
  }
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function cleanCell(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "nan" || s.toLowerCase() === "none") return null;
  return s;
}

function toScore(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn a matrix of cells (row 0 = headers) into candidates. Junk/divider rows
 * with no usable identity are skipped. Returns warnings for skipped rows and
 * unmapped columns.
 */
export function rowsToCandidates(rows: string[][]): {
  candidates: ParsedCandidate[];
  warnings: string[];
} {
  const warnings: string[] = [];
  if (rows.length < 2) {
    return { candidates: [], warnings: ["No data rows were found in the file."] };
  }

  const headerRow = rows[0];
  const fieldByCol = headerRow.map((h) => matchHeader(h));
  const unmapped = headerRow.filter((h, i) => h.trim() && fieldByCol[i] === null);
  if (unmapped.length) {
    warnings.push(`Ignored unrecognized columns: ${unmapped.join(", ")}.`);
  }
  if (!fieldByCol.some(Boolean)) {
    return {
      candidates: [],
      warnings: [
        "Could not match any columns to candidate fields. Expected headers like Name, Email, Phone, Position.",
      ],
    };
  }

  const candidates: ParsedCandidate[] = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.some((c) => cleanCell(c))) continue;
    const c = emptyCandidate();
    for (let col = 0; col < fieldByCol.length; col++) {
      const field = fieldByCol[col];
      if (!field) continue;
      const val = cleanCell(row[col]);
      if (val == null) continue;
      if (field === "score") c.score = toScore(val);
      else c[field] = val;
    }
    // Derive first/last from a single full-name column when needed.
    if (c.full_name && !c.first_name && !c.last_name) {
      const { first, last } = splitFullName(c.full_name);
      c.first_name = first;
      c.last_name = last;
    } else if (!c.full_name && (c.first_name || c.last_name)) {
      c.full_name = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
    }
    if (!candidateHasIdentity(c)) {
      skipped++;
      continue;
    }
    candidates.push(c);
  }
  if (skipped > 0) {
    warnings.push(`Skipped ${skipped} row${skipped === 1 ? "" : "s"} with no name or email.`);
  }
  return { candidates, warnings };
}

/** Parse a CSV/XLS/XLSX buffer into a header+rows matrix using SheetJS. */
export function workbookToRows(buffer: Buffer): string[][] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  });
  return matrix.map((row) => (row as unknown[]).map((c) => (c == null ? "" : String(c))));
}

// ---------------------------------------------------------------------------
// DOCX text extraction — DOCX is a ZIP; pull word/document.xml and strip tags.
// Implemented with Node's zlib so we avoid adding a dependency.
// ---------------------------------------------------------------------------

const ZIP_LOCAL_SIG = 0x04034b50;

export function extractDocxText(buffer: Buffer): string | null {
  try {
    let offset = 0;
    while (offset + 30 <= buffer.length) {
      if (buffer.readUInt32LE(offset) !== ZIP_LOCAL_SIG) break;
      const method = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const nameLen = buffer.readUInt16LE(offset + 26);
      const extraLen = buffer.readUInt16LE(offset + 28);
      const nameStart = offset + 30;
      const name = buffer.toString("utf-8", nameStart, nameStart + nameLen);
      const dataStart = nameStart + nameLen + extraLen;

      if (name === "word/document.xml") {
        let xmlBuf: Buffer;
        if (method === 0) {
          xmlBuf = buffer.subarray(dataStart, dataStart + compressedSize);
        } else if (method === 8) {
          // inflateRaw stops at the end of the deflate stream, so trailing
          // archive bytes are harmless even when the size field is zero.
          xmlBuf = inflateRawSync(buffer.subarray(dataStart));
        } else {
          return null;
        }
        return docxXmlToText(xmlBuf.toString("utf-8"));
      }

      if (compressedSize === 0) break; // streamed entry we can't skip safely
      offset = dataStart + compressedSize;
    }
  } catch {
    return null;
  }
  return null;
}

function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:p[ >]/g, "\n<w:p ") // paragraph breaks
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// LLM extraction — used for resumes (any format) and for PDF list imports.
//
// Resilient provider chain: each *configured* provider is tried in order until
// one succeeds, so the feature keeps working when a single provider hits a
// quota / rate limit. The default order leads with free / generous tiers
// (Gemini, Groq, OpenRouter) so paid OpenAI / Anthropic tokens are only spent
// as a last resort. Providers with no API key are skipped silently.
//
// Configure any subset of these environment variables (more keys = more
// resilience):
//   GEMINI_API_KEY   (or GOOGLE_API_KEY)   GEMINI_MODEL     default gemini-2.0-flash
//   OPENAI_API_KEY                          OPENAI_MODEL     default gpt-4o-mini
//   ANTHROPIC_API_KEY                       ANTHROPIC_MODEL  default claude-3-5-haiku-latest
//   OPENROUTER_API_KEY                      OPENROUTER_MODEL default google/gemini-2.0-flash-exp:free
//   GROQ_API_KEY                            GROQ_MODEL       default llama-3.3-70b-versatile
// Override the try order with LLM_PROVIDER_ORDER (comma-separated provider
// names, e.g. "gemini,groq,openai").
// ---------------------------------------------------------------------------

/** Provider-agnostic piece of prompt content. */
type LlmPart =
  | { kind: "text"; text: string }
  | { kind: "image"; mime: string; base64: string }
  | { kind: "pdf"; filename: string; base64: string };

const EXTRACTION_SCHEMA_HINT = `Return ONLY JSON. Each candidate object uses these keys (use null when unknown):
{
  "first_name": string|null,
  "last_name": string|null,
  "full_name": string|null,
  "email": string|null,
  "phone_mobile": string|null,
  "target_title": string|null,   // role/position they are applying for or most recent job title
  "source": string|null,         // where they applied from, if stated
  "notes": string|null           // 1-3 sentence summary: years of experience, key skills, certifications
}`;

type ProviderCall = { ok: true; content: string } | { ok: false; error: string };

interface LlmProvider {
  name: string;
  supportsImage: boolean;
  supportsPdf: boolean;
  isConfigured: () => boolean;
  call: (system: string, parts: LlmPart[]) => Promise<ProviderCall>;
}

/** Shared caller for OpenAI-compatible chat/completions APIs (OpenAI, Groq, OpenRouter). */
async function callOpenAICompatible(
  opts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    extraHeaders?: Record<string, string>;
  },
  system: string,
  parts: LlmPart[],
): Promise<ProviderCall> {
  const content = parts.map((p) => {
    if (p.kind === "text") return { type: "text", text: p.text };
    if (p.kind === "image") {
      return { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.base64}` } };
    }
    return {
      type: "file",
      file: { filename: p.filename, file_data: `data:application/pdf;base64,${p.base64}` },
    };
  });
  try {
    const res = await fetch(`${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
        ...(opts.extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}` };
    }
    const data = await res.json();
    const out: string = data?.choices?.[0]?.message?.content ?? "";
    return out.trim() ? { ok: true, content: out } : { ok: false, error: "empty response" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

/** Google Gemini (generativeLanguage API). Handles text, images, and PDFs. */
async function callGemini(system: string, parts: LlmPart[]): Promise<ProviderCall> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const geminiParts = parts.map((p) => {
    if (p.kind === "text") return { text: p.text };
    if (p.kind === "image") return { inlineData: { mimeType: p.mime, data: p.base64 } };
    return { inlineData: { mimeType: "application/pdf", data: p.base64 } };
  });
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: geminiParts }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}` };
    }
    const data = await res.json();
    const out: string =
      data?.candidates?.[0]?.content?.parts
        ?.map((x: { text?: string }) => x.text ?? "")
        .join("") ?? "";
    return out.trim() ? { ok: true, content: out } : { ok: false, error: "empty response" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

/** Anthropic Claude (messages API). Handles text, images, and PDFs. */
async function callAnthropic(system: string, parts: LlmPart[]): Promise<ProviderCall> {
  const key = process.env.ANTHROPIC_API_KEY || "";
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";
  const content = parts.map((p) => {
    if (p.kind === "text") return { type: "text", text: p.text };
    if (p.kind === "image") {
      return { type: "image", source: { type: "base64", media_type: p.mime, data: p.base64 } };
    }
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: p.base64 },
    };
  });
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0,
        system: `${system}\nRespond with a single JSON object and nothing else.`,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}` };
    }
    const data = await res.json();
    const out: string =
      data?.content?.map((x: { text?: string }) => x.text ?? "").join("") ?? "";
    return out.trim() ? { ok: true, content: out } : { ok: false, error: "empty response" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

const PROVIDERS: Record<string, LlmProvider> = {
  gemini: {
    name: "Gemini",
    supportsImage: true,
    supportsPdf: true,
    isConfigured: () => Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    call: callGemini,
  },
  openai: {
    name: "OpenAI",
    supportsImage: true,
    supportsPdf: true,
    isConfigured: () => Boolean(process.env.OPENAI_API_KEY),
    call: (s, p) =>
      callOpenAICompatible(
        {
          baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
          apiKey: process.env.OPENAI_API_KEY || "",
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          extraHeaders: process.env.OPENAI_PROJECT_ID
            ? { "OpenAI-Project": process.env.OPENAI_PROJECT_ID }
            : undefined,
        },
        s,
        p,
      ),
  },
  anthropic: {
    name: "Anthropic",
    supportsImage: true,
    supportsPdf: true,
    isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
    call: callAnthropic,
  },
  openrouter: {
    name: "OpenRouter",
    supportsImage: true,
    supportsPdf: false,
    isConfigured: () => Boolean(process.env.OPENROUTER_API_KEY),
    call: (s, p) =>
      callOpenAICompatible(
        {
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: process.env.OPENROUTER_API_KEY || "",
          model: process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-exp:free",
          extraHeaders: {
            "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://greendogops.app",
            "X-Title": "GreenDogOps ATS",
          },
        },
        s,
        p,
      ),
  },
  groq: {
    name: "Groq",
    supportsImage: false,
    supportsPdf: false,
    isConfigured: () => Boolean(process.env.GROQ_API_KEY),
    call: (s, p) =>
      callOpenAICompatible(
        {
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: process.env.GROQ_API_KEY || "",
          model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        },
        s,
        p,
      ),
  },
};

// Free / generous tiers first so paid OpenAI + Anthropic tokens are spent last.
const DEFAULT_ORDER = ["gemini", "groq", "openrouter", "openai", "anthropic"];

function providerOrder(): string[] {
  const raw = process.env.LLM_PROVIDER_ORDER;
  if (!raw) return DEFAULT_ORDER;
  const wanted = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((n) => n in PROVIDERS);
  // Append any providers the user didn't list so a configured key still works.
  return [...wanted, ...DEFAULT_ORDER.filter((n) => !wanted.includes(n))];
}

/** Some models wrap JSON in ```json fences; strip them before parsing. */
function unwrapJson(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : s).trim();
}

/**
 * Try each configured provider in order until one returns content. Providers
 * that can't handle the required media (image / PDF) are skipped. Returns a
 * combined error only when every candidate provider fails.
 */
async function callLLM(
  systemPrompt: string,
  userParts: LlmPart[],
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const needsImage = userParts.some((p) => p.kind === "image");
  const needsPdf = userParts.some((p) => p.kind === "pdf");

  const configured = providerOrder()
    .map((n) => PROVIDERS[n])
    .filter((p): p is LlmProvider => Boolean(p) && p.isConfigured());

  if (!configured.length) {
    return {
      ok: false,
      error:
        "Resume parsing is unavailable: no AI provider is configured. Set one of GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, or GROQ_API_KEY.",
    };
  }

  const failures: string[] = [];
  let skippedForMedia = false;
  for (const provider of configured) {
    if ((needsPdf && !provider.supportsPdf) || (needsImage && !provider.supportsImage)) {
      skippedForMedia = true;
      continue;
    }
    const res = await provider.call(systemPrompt, userParts);
    if (res.ok) return { ok: true, content: unwrapJson(res.content) };
    failures.push(`${provider.name} (${res.error})`);
  }

  if (!failures.length && skippedForMedia) {
    return {
      ok: false,
      error: needsPdf
        ? "This is a PDF and no configured AI provider can read PDFs. Add GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY, or upload a Word / text / image version."
        : "No configured AI provider can read this file type.",
    };
  }
  return { ok: false, error: `All AI providers failed. Tried: ${failures.join("; ")}.` };
}

function coerceCandidate(raw: Record<string, unknown>): ParsedCandidate {
  const c = emptyCandidate();
  const get = (k: string): string | null => {
    const v = raw[k];
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  };
  c.first_name = get("first_name");
  c.last_name = get("last_name");
  c.full_name = get("full_name") ?? ([c.first_name, c.last_name].filter(Boolean).join(" ") || null);
  if (c.full_name && !c.first_name && !c.last_name) {
    const { first, last } = splitFullName(c.full_name);
    c.first_name = first;
    c.last_name = last;
  }
  c.email = get("email");
  c.phone_mobile = get("phone_mobile") ?? get("phone");
  c.target_title = get("target_title") ?? get("title");
  c.source = get("source");
  c.notes = get("notes") ?? get("summary");
  return c;
}

/** Build provider-agnostic content parts for an uploaded document of any type. */
function fileToContentParts(
  filename: string,
  mime: string,
  buffer: Buffer,
): LlmPart[] | { error: string } {
  const lower = filename.toLowerCase();
  const isImage = mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(lower);
  const isPdf = mime === "application/pdf" || lower.endsWith(".pdf");
  const isDocx = lower.endsWith(".docx") || mime.includes("officedocument.wordprocessing");
  const isText = mime.startsWith("text/") || /\.(txt|md|csv|rtf)$/.test(lower);

  if (isImage) {
    return [{ kind: "image", mime: mime || "image/png", base64: buffer.toString("base64") }];
  }
  if (isPdf) {
    return [{ kind: "pdf", filename, base64: buffer.toString("base64") }];
  }
  if (isDocx) {
    const text = extractDocxText(buffer);
    if (!text) return { error: "Could not read text from this Word document." };
    return [{ kind: "text", text }];
  }
  if (isText) {
    return [{ kind: "text", text: buffer.toString("utf-8").slice(0, 200_000) }];
  }
  return {
    error: "Unsupported resume format. Upload a PDF, Word doc, image, or text file.",
  };
}

/** Extract a single candidate from a resume of any supported format. */
export async function extractResumeCandidate(
  filename: string,
  mime: string,
  buffer: Buffer,
): Promise<{ ok: true; candidate: ParsedCandidate } | { ok: false; error: string }> {
  const parts = fileToContentParts(filename, mime, buffer);
  if ("error" in parts) return { ok: false, error: parts.error };

  const result = await callLLM(
    `You extract structured candidate data from a resume for an applicant tracking system at Green Dog, a veterinary company. ${EXTRACTION_SCHEMA_HINT}
Return a single JSON object with key "candidate" holding one candidate object.`,
    [
      {
        kind: "text",
        text: "Extract the candidate's contact details and a short professional summary from this resume.",
      },
      ...parts,
    ],
  );
  if (!result.ok) return result;

  try {
    const parsed = JSON.parse(result.content);
    const obj = (parsed.candidate ?? parsed) as Record<string, unknown>;
    const candidate = coerceCandidate(obj);
    if (!candidateHasIdentity(candidate)) {
      return { ok: false, error: "No name or email could be read from this resume." };
    }
    return { ok: true, candidate };
  } catch {
    return { ok: false, error: "The model returned data that could not be parsed." };
  }
}

/** Extract a list of candidates from a PDF/image roster the parser can't read. */
export async function extractListCandidates(
  filename: string,
  mime: string,
  buffer: Buffer,
): Promise<{ ok: true; candidates: ParsedCandidate[] } | { ok: false; error: string }> {
  const parts = fileToContentParts(filename, mime, buffer);
  if ("error" in parts) return { ok: false, error: parts.error };

  const result = await callLLM(
    `You extract a list of job candidates from an uploaded document for an applicant tracking system at Green Dog, a veterinary company. ${EXTRACTION_SCHEMA_HINT}
Return a single JSON object with key "candidates" holding an array of candidate objects (one per person listed).`,
    [
      {
        kind: "text",
        text: "Extract every distinct candidate listed in this document. Do not invent people.",
      },
      ...parts,
    ],
  );
  if (!result.ok) return result;

  try {
    const parsed = JSON.parse(result.content);
    const arr: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.candidates)
        ? parsed.candidates
        : [];
    const candidates = arr
      .map((o) => coerceCandidate(o as Record<string, unknown>))
      .filter(candidateHasIdentity);
    if (!candidates.length) {
      return { ok: false, error: "No candidates could be read from this document." };
    }
    return { ok: true, candidates };
  } catch {
    return { ok: false, error: "The model returned data that could not be parsed." };
  }
}
