/** Inline tokens for Ziggy's minimal markdown renderer. */
export type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

// Order matters: markdown links before bare URLs so `[t](url)` isn't split.
const INLINE_RE =
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s<>()]+)/g;

/** Only http(s) links are ever produced — the answer text is LLM output. */
export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = tokens[tokens.length - 1];
    if (last?.type === "text") last.text += t;
    else tokens.push({ type: "text", text: t });
  };

  let lastIndex = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const start = m.index ?? 0;
    pushText(text.slice(lastIndex, start));
    let consumed = m[0];

    if (m[1] !== undefined && m[2] !== undefined) {
      const href = safeHref(m[2]);
      if (href) tokens.push({ type: "link", text: m[1], href });
      else pushText(m[0]);
    } else if (m[3] !== undefined) {
      tokens.push({ type: "bold", text: m[3] });
    } else if (m[4] !== undefined) {
      tokens.push({ type: "code", text: m[4] });
    } else if (m[5] !== undefined) {
      // Trailing sentence punctuation belongs to the prose, not the URL.
      const url = m[5].replace(/[.,;:!?'"]+$/, "");
      consumed = url;
      const href = safeHref(url);
      if (href) tokens.push({ type: "link", text: url, href });
      else pushText(url);
    }
    lastIndex = start + consumed.length;
  }
  pushText(text.slice(lastIndex));
  return tokens;
}
