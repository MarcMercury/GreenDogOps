// Native policy documents are stored as TipTap (ProseMirror) JSON. Everything
// that reaches the database goes through sanitizeDocument(), an allow-list of
// the node types, marks and attributes the editor supports, so a crafted
// payload cannot smuggle script URLs or unknown nodes into what other users
// render. No value imports: the Google/Word import scripts run this file
// directly under Node.

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
}

/** Hard cap on a stored document (images are inline data URLs). */
export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
/** Hard cap on one inline image. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const ALIGN = new Set(["left", "center", "right", "justify"]);
const LIST_TYPES = new Set(["1", "a", "A", "i", "I"]);

type AttrRule = (value: unknown) => unknown;

const int = (min: number, max: number): AttrRule => (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
const align: AttrRule = (v) => (typeof v === "string" && ALIGN.has(v) ? v : undefined);
const shortText = (max: number): AttrRule => (v) =>
  typeof v === "string" && v.length <= max ? v : undefined;
const colwidth: AttrRule = (v) =>
  Array.isArray(v) && v.length <= 50 && v.every((n) => Number.isInteger(n) && n > 0 && n < 5000)
    ? v
    : undefined;

const NODE_ATTRS: Record<string, Record<string, AttrRule>> = {
  doc: {},
  text: {},
  paragraph: { textAlign: align },
  heading: { level: int(1, 6), textAlign: align },
  bulletList: {},
  orderedList: {
    start: int(1, 10000),
    type: (v) => (typeof v === "string" && LIST_TYPES.has(v) ? v : undefined),
  },
  listItem: {},
  blockquote: {},
  codeBlock: { language: (v) => (typeof v === "string" && /^[a-z0-9+#-]{1,30}$/i.test(v) ? v : undefined) },
  hardBreak: {},
  horizontalRule: {},
  image: {
    src: (v) => (typeof v === "string" && isSafeImageSrc(v) ? v : undefined),
    alt: shortText(300),
    title: shortText(300),
    width: int(1, 5000),
    height: int(1, 5000),
  },
  table: {},
  tableRow: {},
  tableHeader: { colspan: int(1, 50), rowspan: int(1, 50), colwidth },
  tableCell: { colspan: int(1, 50), rowspan: int(1, 50), colwidth },
};

const MARK_ATTRS: Record<string, Record<string, AttrRule>> = {
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  code: {},
  link: { href: (v) => (typeof v === "string" && isSafeHref(v) ? v : undefined) },
};

/** http(s), mailto, tel, or an in-app path ("/resources/doc/…"). */
export function isSafeHref(href: string): boolean {
  const h = href.trim();
  if (!h || h.length > 2000) return false;
  if (h.startsWith("/")) return !h.startsWith("//") && !h.startsWith("/\\");
  if (h.startsWith("#")) return true;
  return /^(https?:\/\/|mailto:|tel:)/i.test(h);
}

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;

export function isSafeImageSrc(src: string): boolean {
  if (src.startsWith("data:")) {
    return src.length <= Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 40 && DATA_IMAGE.test(src);
  }
  return /^https:\/\/[^\s]+$/i.test(src) && src.length <= 2000;
}

function cleanAttrs(
  raw: unknown,
  rules: Record<string, AttrRule>,
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(rules)) {
    const value = rule((raw as Record<string, unknown>)[key]);
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanMarks(raw: unknown): DocMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: DocMark[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const type = (m as DocMark).type;
    const rules = typeof type === "string" ? MARK_ATTRS[type] : undefined;
    if (!rules) continue;
    const attrs = cleanAttrs((m as DocMark).attrs, rules);
    // A link whose href failed validation is dropped, keeping the text.
    if (type === "link" && !attrs?.href) continue;
    out.push(attrs ? { type, attrs } : { type });
  }
  return out.length ? out : undefined;
}

function cleanNode(raw: unknown, depth: number): DocNode | null {
  if (!raw || typeof raw !== "object" || depth > 40) return null;
  const node = raw as DocNode;
  const rules = typeof node.type === "string" ? NODE_ATTRS[node.type] : undefined;
  if (!rules || node.type === "doc") return null;

  if (node.type === "text") {
    if (typeof node.text !== "string" || node.text.length === 0) return null;
    const marks = cleanMarks(node.marks);
    return marks ? { type: "text", text: node.text, marks } : { type: "text", text: node.text };
  }

  const out: DocNode = { type: node.type };
  const attrs = cleanAttrs(node.attrs, rules);
  if (attrs) out.attrs = attrs;
  if (node.type === "image" && !attrs?.src) return null;
  if (Array.isArray(node.content)) {
    const content = node.content
      .map((c) => cleanNode(c, depth + 1))
      .filter((c): c is DocNode => c !== null);
    if (content.length) out.content = content;
  }
  return out;
}

/**
 * Return an allow-listed copy of a TipTap document, or null when the input is
 * not a document at all. Unknown nodes, marks and attributes are dropped.
 */
export function sanitizeDocument(raw: unknown): DocNode | null {
  if (!raw || typeof raw !== "object" || (raw as DocNode).type !== "doc") return null;
  const content = Array.isArray((raw as DocNode).content)
    ? (raw as DocNode).content!
        .map((c) => cleanNode(c, 1))
        .filter((c): c is DocNode => c !== null)
    : [];
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** True when the document has no visible text and no images. */
export function isEmptyDocument(doc: DocNode): boolean {
  const walk = (n: DocNode): boolean =>
    (n.type === "text" && !!n.text?.trim()) ||
    n.type === "image" ||
    (n.content ?? []).some(walk);
  return !walk(doc);
}

function inlineText(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(inlineText).join("");
}

function blockLines(node: DocNode, indent: string): string[] {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "codeBlock": {
      const t = inlineText(node).trim();
      return t ? t.split("\n").map((l) => indent + l) : [];
    }
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      let n = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
      const lines: string[] = [];
      for (const item of node.content ?? []) {
        const marker = ordered ? `${n++}. ` : "- ";
        const inner = (item.content ?? []).flatMap((c) => blockLines(c, `${indent}  `));
        if (!inner.length) continue;
        lines.push(`${indent}${marker}${inner[0].slice(indent.length + 2)}`, ...inner.slice(1));
      }
      return lines;
    }
    case "blockquote":
      return (node.content ?? []).flatMap((c) => blockLines(c, indent)).map((l) => `> ${l}`);
    case "table":
      return (node.content ?? [])
        .map((row) =>
          (row.content ?? [])
            .map((cell) => (cell.content ?? []).flatMap((c) => blockLines(c, "")).join(" ").trim())
            .join(" | "),
        )
        .filter((l) => l.replace(/[|\s]/g, ""))
        .map((l) => indent + l);
    default:
      return (node.content ?? []).flatMap((c) => blockLines(c, indent));
  }
}

/** Plain text for search / Ask Ziggy: one block per paragraph, lists as "- ". */
export function documentText(doc: DocNode): string {
  return (doc.content ?? [])
    .map((block) => blockLines(block, "").join("\n"))
    .filter(Boolean)
    .join("\n\n");
}
