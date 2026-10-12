// ---------------------------------------------------------------------------
// Ask Ziggy: checks on the model's SQL that catch WRONG answers which still
// run. The database only rejects broken SQL; these catch queries that run fine
// but answer a different question:
//
// - a filter on a value that does not exist ('code_101' for the tag stored as
//   'code *101*'). In an exclusion that silently excludes NOBODY.
// - NOT IN (subquery): one NULL in the subquery makes it return zero rows.
// - a date window older than the table's history: the missing years read as
//   "nothing happened".
//
// Pure functions so they can be unit-tested; smart.ts loads the vocabularies.
// ---------------------------------------------------------------------------

export type LiteralFilter = { literal: string; pattern: boolean };

/** A free-text column whose real values are known, so literals compared against it can be checked. */
export type VocabSpec = {
  /** Only check SQL that reads one of these relations — elsewhere the column name means something else. */
  relation: RegExp;
  /** Column name pattern (regex source, no anchors). */
  column: string;
  /** One cell holds several comma-joined items, so `=` / IN can never be right. */
  multiValued: boolean;
  label: string;
  /** How to filter this column correctly, shown to the model with the real values. */
  advice: string;
};

export const TAG_SPEC: VocabSpec = {
  relation: /\breport_contact_tag(?:_summary)?\b/i,
  column: String.raw`tag(?:_norm)?`,
  multiValued: false,
  label: "tag",
  advice:
    "Use the exact tag_norm spelling (ezyVet tags often contain asterisks, e.g. 'code *101*'). A NOT EXISTS / NOT IN / <> on a tag that does not exist excludes NOBODY.",
};

export const PROBLEM_SPEC: VocabSpec = {
  relation: /\b(?:ezyvet_animal|report_appointment_detail)\b/i,
  column: "master_problems",
  multiValued: true,
  label: "master problem",
  advice:
    "master_problems is a comma-joined list ('FEAR FREE PVQ,*AP REQUIRED'), so match one item with master_problems ILIKE '%<item>%' using the item's real spelling; never = or IN. Flags start with an asterisk, and '%AP%' alone also matches '*AP Recommended'.",
};

const WRAPPER = String.raw`(?:\b(?:lower|upper|btrim|trim|coalesce)\s*\(\s*)?`;
const WRAPPER_CLOSE = String.raw`(?:\s*,\s*'[^']*')?\s*\)?`;
const OPERATOR = String.raw`(=\s*any|<>|!=|=|not\s+i?like|i?like|not\s+in|in)`;

function comparisonRegExp(column: string): RegExp {
  return new RegExp(
    `${WRAPPER}(?:\\b[a-z_][a-z0-9_]*\\s*\\.\\s*)?\\b(?:${column})\\b${WRAPPER_CLOSE}\\s*${OPERATOR}\\s*`,
    "gi",
  );
}

/** Reads one optionally lower()/trim()-wrapped string literal at `pos`. */
function readLiteral(sql: string, pos: number): { value: string; end: number } | null {
  const head = /^\s*(?:(?:lower|btrim|trim|upper)\s*\(\s*)*(?:e(?='))?'/i.exec(sql.slice(pos));
  if (!head) return null;
  let i = pos + head[0].length;
  let value = "";
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        value += "'";
        i += 2;
        continue;
      }
      const close = /^'(?:\s*::\s*text)?(?:\s*\))*/i.exec(sql.slice(i));
      return { value, end: i + (close ? close[0].length : 1) };
    }
    value += sql[i];
    i += 1;
  }
  return null;
}

/** Every string literal the SQL compares against `spec`'s column. */
export function filterLiterals(sql: string, spec: VocabSpec): LiteralFilter[] {
  if (!spec.relation.test(sql)) return [];
  const out: LiteralFilter[] = [];
  for (const m of sql.matchAll(comparisonRegExp(spec.column))) {
    const op = m[1].toLowerCase().replace(/\s+/g, " ");
    let pos = (m.index ?? 0) + m[0].length;

    if (op === "in" || op === "not in" || op.startsWith("=")) {
      const open = /^\s*\(?\s*(?:array\s*\[)?/i.exec(sql.slice(pos));
      const listed = op === "in" || op === "not in" || /[([]/.test(open?.[0] ?? "");
      if (listed) {
        pos += open ? open[0].length : 0;
        for (;;) {
          const lit = readLiteral(sql, pos);
          if (!lit) break;
          out.push({ literal: lit.value, pattern: false });
          const sep = /^\s*,/.exec(sql.slice(lit.end));
          if (!sep) break;
          pos = lit.end + sep[0].length;
        }
        continue;
      }
    }

    const lit = readLiteral(sql, pos);
    if (lit) out.push({ literal: lit.value, pattern: op.endsWith("like") });
  }
  return out;
}

/** Every string literal the SQL compares against a tag / tag_norm column. */
export function tagFilterLiterals(sql: string): LiteralFilter[] {
  return filterLiterals(sql, TAG_SPEC);
}

/** SQL LIKE pattern -> anchored, case-insensitive RegExp (ILIKE semantics). */
export function likeToRegExp(pattern: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      re += esc(pattern[i + 1]);
      i += 1;
    } else if (ch === "%") re += ".*";
    else if (ch === "_") re += ".";
    else re += esc(ch);
  }
  return new RegExp(`^${re}$`, "is");
}

function matches(filter: LiteralFilter, vocab: string[]): boolean {
  if (filter.pattern) {
    const re = likeToRegExp(filter.literal);
    return vocab.some((t) => re.test(t));
  }
  const want = filter.literal.trim().toLowerCase();
  return vocab.some((t) => t.toLowerCase() === want);
}

/**
 * Filters on `spec`'s column that match nothing in `vocab`. On a multi-valued
 * column every `=` / IN filter is wrong (it only matches cells holding that
 * one item), and a LIKE pattern spanning a comma is not checked.
 */
export function unmatchedFilters(sql: string, spec: VocabSpec, vocab: string[]): LiteralFilter[] {
  if (!vocab.length) return [];
  const seen = new Set<string>();
  return filterLiterals(sql, spec).filter((f) => {
    const key = `${f.pattern}:${f.literal}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (spec.multiValued) {
      if (!f.pattern) return true;
      if (f.literal.includes(",")) return false;
    }
    return !matches(f, vocab);
  });
}

export function unmatchedTagFilters(sql: string, vocab: string[]): LiteralFilter[] {
  return unmatchedFilters(sql, TAG_SPEC, vocab);
}

/** Real values sharing a number or word with the guessed literal, closest first. */
export function similarValues(literal: string, vocab: string[]): string[] {
  const tokens = literal
    .toLowerCase()
    .split(/[^a-z0-9$]+/)
    .filter((t) => /\d/.test(t) || t.length >= 3);
  if (!tokens.length) return [];
  return vocab
    .map((v) => ({ v, hits: tokens.filter((t) => v.toLowerCase().includes(t)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((x) => x.v);
}

/** Retry message for the model: which literals are wrong and what is actually stored. */
export function vocabMismatchError(spec: VocabSpec, bad: LiteralFilter[], vocab: string[]): string {
  const lines = bad.map((f) => {
    if (spec.multiValued && !f.pattern) {
      return `- = / IN '${f.literal}' only matches rows whose ENTIRE list is that one item`;
    }
    const close = similarValues(f.literal.replace(/[%_]/g, " "), vocab);
    return `- '${f.literal}' matches no ${spec.label}${
      close.length ? `; the real value is probably ${close.slice(0, 5).map((t) => `'${t}'`).join(" or ")}` : ""
    }`;
  });
  return `These ${spec.label} filters do not match what is stored, so they silently filter the wrong rows:\n${lines.join(
    "\n",
  )}\n${spec.advice} ${vocab.length > 50 ? `The 50 most common ${spec.label}s` : `Every ${spec.label} in use`}: ${vocab
    .slice(0, 50)
    .map((t) => `'${t}'`)
    .join(", ")}.`;
}

export function tagMismatchError(bad: LiteralFilter[], vocab: string[]): string {
  return vocabMismatchError(TAG_SPEC, bad, vocab);
}

/**
 * NOT IN (SELECT ...) returns zero rows as soon as the subquery yields one
 * NULL, which reads as "nobody qualifies". NOT EXISTS has no such trap.
 */
export function notInSubqueryProblem(sql: string): string | null {
  if (!/\bnot\s+in\s*\(\s*(?:select|with)\b/i.test(sql)) return null;
  return "Do not use NOT IN (SELECT ...): a single NULL in the subquery makes it return ZERO rows. Rewrite the exclusion as AND NOT EXISTS (SELECT 1 FROM ... WHERE <inner key> = <outer key> AND ...).";
}

/**
 * contact_tags is one comma-joined cell ('ap, code *501*'), so a pattern on it
 * matches inside other tags and a NOT LIKE drops clients who have any other tag.
 */
export function rawTagTextProblem(sql: string): string | null {
  if (!/\bcontact_tags\b\s*(?:::\s*text\s*)?(?:not\s+)?(?:i?like|~~?\*?|similar\s+to|=)/i.test(sql)) return null;
  return "Do not match the comma-joined contact_tags text. Filter tags through report_contact_tag (one row per client per tag) on tag_norm, using EXISTS / NOT EXISTS on contact_code.";
}

/** How far back each dated table's history goes. */
export type Coverage = {
  relation: RegExp;
  columns: string;
  /** Other relations sharing the column name — when present, the column is ambiguous and not checked. */
  ambiguousWith?: RegExp;
  start: string;
  label: string;
};

export const COVERAGE: Coverage[] = [
  {
    relation: /\bezyvet_invoice_line\b/i,
    columns: "line_date|invoice_date",
    ambiguousWith: /\b(?:ezyvet_invoice_summary|ezyvet_staff_sale)\b/i,
    start: "2025-01-02",
    label: "Billed lines (ezyvet_invoice_line)",
  },
  {
    relation:
      /\b(?:ezyvet_appointment_record|report_appointment_detail|report_appointment_type_volume|report_appointment_type_by_species)\b/i,
    columns: "appt_date",
    ambiguousWith:
      /\b(?:ezyvet_agenda_\w+|ezyvet_appointment_status|ezyvet_cancelled_appointment|ezyvet_soc_overdue|ezyvet_unbilled_consult|report_appointment_flow|report_capacity_override|report_soc_overdue_current|report_unbilled_consults_current)\b/i,
    start: "2024-11-01",
    label: "Appointment records (ezyvet_appointment_record and its report views)",
  },
];

export type CoverageGap = { label: string; start: string; earliest: string };

const DATE_LITERAL = String.raw`(?:date\s+)?'(\d{4}-\d{2}-\d{2})[^']*'(?:\s*::\s*(?:date|timestamptz|timestamp))?`;

/** Date literals compared against `columns` (both BETWEEN bounds included). */
export function comparedDates(sql: string, columns: string): string[] {
  const col = String.raw`(?:\b[a-z_][a-z0-9_]*\s*\.\s*)?\b(?:${columns})\b(?:\s*::\s*date)?`;
  const re = new RegExp(
    `${col}\\s*(?:(?:>=|<=|<>|!=|>|<|=)\\s*${DATE_LITERAL}|(?:not\\s+)?between\\s+${DATE_LITERAL}\\s+and\\s+${DATE_LITERAL})`,
    "gi",
  );
  const out: string[] = [];
  for (const m of sql.matchAll(re)) for (const d of m.slice(1)) if (d) out.push(d);
  return out;
}

/** Windows that reach back before a table's history starts. */
export function coverageGaps(sql: string): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const c of COVERAGE) {
    if (!c.relation.test(sql) || c.ambiguousWith?.test(sql)) continue;
    const early = comparedDates(sql, c.columns).filter((d) => d < c.start).sort();
    if (early.length) gaps.push({ label: c.label, start: c.start, earliest: early[0] });
  }
  return gaps;
}

export function coverageError(gaps: CoverageGap[]): string {
  return `${gaps
    .map((g) => `${g.label} only exist from ${g.start}, but this query filters back to ${g.earliest}`)
    .join("; ")}. Everything before that is MISSING, not zero, so the result would be incomplete. For a client/pet whose LAST visit falls in an older window use ezyvet_contact.last_invoiced / ezyvet_animal.last_visit (back to 2014). Otherwise start the window at the first covered date and say so in "note".`;
}

/** Shown under the answer when the model keeps a window the data cannot fully cover. */
export function coverageWarning(gaps: CoverageGap[]): string {
  return `_Data note: ${gaps
    .map((g) => `${g.label.split(" (")[0].toLowerCase()} only go back to ${g.start}`)
    .join("; ")}, so anything earlier is not included in these results._`;
}
