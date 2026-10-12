// ---------------------------------------------------------------------------
// Ask Ziggy: client-tag filters must name a tag that exists.
//
// ezyVet tags are free text ('code *101*', not 'code 101' or 'code_101'), and
// report_contact_tag is a view, so smart_value_hints() never shows the model
// the real spellings. A guessed spelling matches nothing, and in an exclusion
// ("remove anyone tagged 101") that silently excludes NOBODY — the list looks
// right and is wrong. These helpers find every literal compared against
// tag / tag_norm and check it against the live tag vocabulary.
// ---------------------------------------------------------------------------

/** Only these relations expose `tag` / `tag_norm`; elsewhere the names are not tag filters. */
const TAG_RELATION = /\breport_contact_tag(?:_summary)?\b/i;

const TAG_COLUMN = String.raw`(?:\b(?:lower|btrim|trim)\s*\(\s*)?(?:\b[a-z_][a-z0-9_]*\s*\.\s*)?\btag(?:_norm)?\b\s*\)?`;
const TAG_OPERATOR = String.raw`(=\s*any|<>|!=|=|not\s+i?like|i?like|not\s+in|in)`;
const TAG_COMPARISON = new RegExp(`${TAG_COLUMN}\\s*${TAG_OPERATOR}\\s*`, "gi");

export type TagFilter = { literal: string; pattern: boolean };

/** Reads one optionally lower()/trim()-wrapped string literal at `pos`. */
function readLiteral(sql: string, pos: number): { value: string; end: number } | null {
  const head = /^\s*(?:(?:lower|btrim|trim|upper)\s*\(\s*)*(?:e(?=')|)'/i.exec(sql.slice(pos));
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
      const close = /^'(?:\s*\))*/.exec(sql.slice(i));
      return { value, end: i + (close ? close[0].length : 1) };
    }
    value += sql[i];
    i += 1;
  }
  return null;
}

/** Every string literal the SQL compares against a tag / tag_norm column. */
export function tagFilterLiterals(sql: string): TagFilter[] {
  if (!TAG_RELATION.test(sql)) return [];
  const out: TagFilter[] = [];
  for (const m of sql.matchAll(TAG_COMPARISON)) {
    const op = m[1].toLowerCase().replace(/\s+/g, " ");
    let pos = (m.index ?? 0) + m[0].length;
    const pattern = op.endsWith("like");

    if (op === "in" || op === "not in" || op.startsWith("=")) {
      const open = /^\s*\(?\s*(?:array\s*\[)?/i.exec(sql.slice(pos));
      const listed = op === "in" || op === "not in" || /[([]/.test(open?.[0] ?? "");
      if (listed) {
        pos += open ? open[0].length : 0;
        for (;;) {
          const lit = readLiteral(sql, pos);
          if (!lit) break;
          out.push({ literal: lit.value, pattern: false });
          const sep = /^\s*(?:::\s*text\s*)?,/.exec(sql.slice(lit.end));
          if (!sep) break;
          pos = lit.end + sep[0].length;
        }
        continue;
      }
    }

    const lit = readLiteral(sql, pos);
    if (lit) out.push({ literal: lit.value, pattern });
  }
  return out;
}

/** SQL LIKE pattern -> anchored, case-insensitive RegExp (ILIKE semantics). */
export function likeToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      re += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    } else if (ch === "%") re += ".*";
    else if (ch === "_") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is");
}

function matches(filter: TagFilter, vocab: string[]): boolean {
  if (filter.pattern) {
    const re = likeToRegExp(filter.literal);
    return vocab.some((t) => re.test(t));
  }
  const want = filter.literal.trim().toLowerCase();
  return vocab.some((t) => t === want);
}

/** Tag filters in `sql` that match no tag in `vocab` (lower-cased tag_norm values). */
export function unmatchedTagFilters(sql: string, vocab: string[]): TagFilter[] {
  if (!vocab.length) return [];
  const seen = new Set<string>();
  return tagFilterLiterals(sql).filter((f) => {
    const key = `${f.pattern}:${f.literal}`;
    if (seen.has(key) || matches(f, vocab)) return false;
    seen.add(key);
    return true;
  });
}

/** Real tags sharing a number or word with the guessed literal, closest first. */
export function similarTags(literal: string, vocab: string[]): string[] {
  const tokens = literal
    .toLowerCase()
    .split(/[^a-z0-9$]+/)
    .filter((t) => /\d/.test(t) || t.length >= 3);
  if (!tokens.length) return [];
  return vocab
    .map((tag) => ({ tag, hits: tokens.filter((t) => tag.includes(t)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((x) => x.tag);
}

/** Retry message for the model: which literals are wrong and what is actually stored. */
export function tagMismatchError(bad: TagFilter[], vocab: string[]): string {
  const lines = bad.map((f) => {
    const close = similarTags(f.literal.replace(/[%_]/g, " "), vocab);
    return `- '${f.literal}' matches no tag${
      close.length ? `; the real tag is probably ${close.slice(0, 5).map((t) => `'${t}'`).join(" or ")}` : ""
    }`;
  });
  return `These tag filters match no tag that exists, so they filter nothing — and a NOT EXISTS / NOT IN / <> on a tag that does not exist excludes NOBODY:\n${lines.join(
    "\n",
  )}\nUse the exact tag_norm spelling (ezyVet tags often contain asterisks, e.g. 'code *101*'). Every tag_norm in use: ${vocab
    .map((t) => `'${t}'`)
    .join(", ")}.`;
}
