// Convert Google Docs (Docs API JSON) and Word .docx (WordprocessingML) into
// TipTap JSON for native policy documents. Pure functions: the caller fetches
// the files and resolves images to data URLs; the result still goes through
// sanitizeDocument() before it is stored.
//
// Kept in one file with only `import type` so scripts/import_google_docs_native.mjs
// can run it under Node's type stripping (a value import between .ts files
// would need a ".ts" specifier, which the app's tsconfig rejects).

import type { DocMark, DocNode } from "./content";

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

export interface ImportOptions {
  /** Data URL (or https URL) for an embedded image id, or null to drop it. */
  imageSrc: (id: string) => string | null;
  /** Rewrite a hyperlink (e.g. a Google Doc URL to its native /resources/doc/… page). */
  rewriteLink?: (url: string) => string;
}

type Align = "center" | "right" | "justify" | undefined;

interface ParaInfo {
  /** Inline content and block images, in document order. */
  segments: DocNode[];
  heading?: number;
  align?: Align;
  list?: { key: string; level: number; ordered: boolean };
}

const PX_PER_PT = 4 / 3;

function textNode(text: string, marks: DocMark[]): DocNode | null {
  if (!text) return null;
  return marks.length ? { type: "text", text, marks: marks.map((m) => ({ ...m })) } : { type: "text", text };
}

/** Split text on soft line breaks into text + hardBreak nodes. */
function textWithBreaks(text: string, marks: DocMark[], breakChar: RegExp): DocNode[] {
  const out: DocNode[] = [];
  text.split(breakChar).forEach((part, i) => {
    if (i > 0) out.push({ type: "hardBreak" });
    const n = textNode(part, marks);
    if (n) out.push(n);
  });
  return out;
}

/** Turn one source paragraph into blocks: inline runs become paragraphs/headings, images and rules stand alone. */
function paragraphBlocks(p: ParaInfo): DocNode[] {
  const blocks: DocNode[] = [];
  let inline: DocNode[] = [];
  const flush = (force: boolean) => {
    while (inline.length && inline[inline.length - 1].type === "hardBreak") inline.pop();
    if (!inline.length && !force) return;
    const attrs: Record<string, unknown> = {};
    if (p.align) attrs.textAlign = p.align;
    const node: DocNode = p.heading
      ? { type: "heading", attrs: { ...attrs, level: p.heading } }
      : { type: "paragraph" };
    if (!p.heading && p.align) node.attrs = attrs;
    if (inline.length) node.content = inline;
    blocks.push(node);
    inline = [];
  };
  for (const seg of p.segments) {
    if (seg.type === "image" || seg.type === "horizontalRule") {
      flush(false);
      blocks.push(seg);
    } else {
      inline.push(seg);
    }
  }
  flush(blocks.length === 0);
  return blocks;
}

/** Nest consecutive list paragraphs into bullet/ordered lists. */
function assembleBlocks(paras: ParaInfo[]): DocNode[] {
  const out: DocNode[] = [];
  let stack: { level: number; ordered: boolean; key: string; node: DocNode }[] = [];

  for (const p of paras) {
    const blocks = paragraphBlocks(p);
    if (!p.list) {
      stack = [];
      out.push(...blocks);
      continue;
    }
    const { level, ordered, key } = p.list;
    while (stack.length && stack[stack.length - 1].level > level) stack.pop();
    let top = stack[stack.length - 1];
    if (top && top.level === level && (top.ordered !== ordered || top.key !== key)) {
      stack.pop();
      top = stack[stack.length - 1];
    }
    if (!top || top.level < level) {
      const list: DocNode = { type: ordered ? "orderedList" : "bulletList", content: [] };
      const parentItems = top?.node.content;
      const parentItem = parentItems?.[parentItems.length - 1];
      if (parentItem) parentItem.content!.push(list);
      else out.push(list);
      stack.push({ level, ordered, key, node: list });
      top = stack[stack.length - 1];
    }
    // A list item must start with a paragraph.
    const content = blocks[0]?.type === "paragraph" ? blocks : [{ type: "paragraph" }, ...blocks];
    top.node.content!.push({ type: "listItem", content });
  }
  return tidyBlocks(out);
}

const isBlankParagraph = (n: DocNode) => n.type === "paragraph" && !n.content?.length;

/** Drop leading/trailing blank paragraphs and collapse runs of them to one. */
function tidyBlocks(blocks: DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  for (const b of blocks) {
    if (isBlankParagraph(b) && (!out.length || isBlankParagraph(out[out.length - 1]))) continue;
    out.push(b);
  }
  while (out.length && isBlankParagraph(out[out.length - 1])) out.pop();
  return out;
}

function cellBlocks(blocks: DocNode[]): DocNode[] {
  const tidy = tidyBlocks(blocks);
  return tidy.length ? tidy : [{ type: "paragraph" }];
}

function linkMark(url: string | undefined, opts: ImportOptions): DocMark | null {
  if (!url) return null;
  const href = opts.rewriteLink ? opts.rewriteLink(url) : url;
  return { type: "link", attrs: { href } };
}

// ---------------------------------------------------------------------------
// Google Docs (Docs API v1, documents.get with includeTabsContent)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- Docs API JSON is untyped here */
type GDoc = any;

const ORDERED_GLYPHS = new Set(["DECIMAL", "ZERO_DECIMAL", "ALPHA", "UPPER_ALPHA", "ROMAN", "UPPER_ROMAN"]);
const G_ALIGN: Record<string, Align> = { CENTER: "center", END: "right", JUSTIFIED: "justify" };

function gHeading(style: string | undefined): number | undefined {
  if (style === "TITLE") return 1;
  if (style === "SUBTITLE") return 2;
  const m = /^HEADING_(\d)$/.exec(style ?? "");
  return m ? Math.min(6, Number(m[1])) : undefined;
}

function gImage(obj: GDoc, id: string, opts: ImportOptions): DocNode | null {
  const embedded = obj?.embeddedObject;
  if (!embedded?.imageProperties) return null;
  const src = opts.imageSrc(id);
  if (!src) return null;
  const attrs: Record<string, unknown> = { src };
  const w = embedded.size?.width;
  if (w?.unit === "PT" && w.magnitude > 0) attrs.width = Math.round(w.magnitude * PX_PER_PT);
  if (embedded.title || embedded.description) attrs.alt = String(embedded.title || embedded.description).slice(0, 300);
  return { type: "image", attrs };
}

/** The tab's document (first tab) from a documents.get response. */
export function googleDocTab(data: GDoc): GDoc {
  return data?.tabs?.[0]?.documentTab ?? data;
}

export function googleDocToTiptap(data: GDoc, opts: ImportOptions): DocNode {
  const tab = googleDocTab(data);
  const lists = tab.lists ?? {};
  const footnotes: { n: string; content: GDoc[] }[] = [];

  const convertElements = (elements: GDoc[]): DocNode[] => {
    const paras: ParaInfo[] = [];
    const flushTo: DocNode[] = [];
    const flushParas = () => {
      if (paras.length) flushTo.push(...assembleBlocks(paras.splice(0)));
    };
    for (const el of elements ?? []) {
      if (el.table) {
        flushParas();
        const rows = (el.table.tableRows ?? []).map((row: GDoc) => ({
          type: "tableRow",
          content: (row.tableCells ?? []).map((cell: GDoc) => {
            const attrs: Record<string, unknown> = {};
            const cs = cell.tableCellStyle ?? {};
            if (cs.columnSpan > 1) attrs.colspan = cs.columnSpan;
            if (cs.rowSpan > 1) attrs.rowspan = cs.rowSpan;
            const node: DocNode = { type: "tableCell", content: cellBlocks(convertElements(cell.content)) };
            if (Object.keys(attrs).length) node.attrs = attrs;
            return node;
          }),
        }));
        flushTo.push({ type: "table", content: rows });
        continue;
      }
      const p = el.paragraph;
      if (!p) continue;
      const segments: DocNode[] = [];
      for (const pe of p.elements ?? []) {
        if (pe.textRun) {
          const s = pe.textRun.textStyle ?? {};
          const content = String(pe.textRun.content ?? "").replace(/\n$/, "");
          const link = linkMark(s.link?.url, opts);
          const marks: DocMark[] = [];
          if (s.bold) marks.push({ type: "bold" });
          if (s.italic) marks.push({ type: "italic" });
          if (s.underline && !link) marks.push({ type: "underline" });
          if (s.strikethrough) marks.push({ type: "strike" });
          if (link) marks.push(link);
          segments.push(...textWithBreaks(content, marks, /[\u000b\n]/));
        } else if (pe.inlineObjectElement) {
          const id = pe.inlineObjectElement.inlineObjectId;
          const img = gImage(tab.inlineObjects?.[id]?.inlineObjectProperties, id, opts);
          if (img) segments.push(img);
        } else if (pe.horizontalRule) {
          segments.push({ type: "horizontalRule" });
        } else if (pe.footnoteReference) {
          const n = String(pe.footnoteReference.footnoteNumber ?? footnotes.length + 1);
          const fn = tab.footnotes?.[pe.footnoteReference.footnoteId];
          if (fn) footnotes.push({ n, content: fn.content ?? [] });
          segments.push({ type: "text", text: `[${n}]` });
        } else if (pe.richLink) {
          const props = pe.richLink.richLinkProperties ?? {};
          const link = linkMark(props.uri, opts);
          const n = textNode(String(props.title ?? props.uri ?? ""), link ? [link] : []);
          if (n) segments.push(n);
        } else if (pe.person) {
          const props = pe.person.personProperties ?? {};
          const n = textNode(String(props.name ?? props.email ?? ""), []);
          if (n) segments.push(n);
        }
      }
      for (const id of p.positionedObjectIds ?? []) {
        const img = gImage(tab.positionedObjects?.[id]?.positionedObjectProperties, id, opts);
        if (img) segments.push(img);
      }

      const info: ParaInfo = {
        segments,
        heading: gHeading(p.paragraphStyle?.namedStyleType),
        align: G_ALIGN[p.paragraphStyle?.alignment],
      };
      if (p.bullet) {
        const level = Number(p.bullet.nestingLevel ?? 0);
        const glyph = lists[p.bullet.listId]?.listProperties?.nestingLevels?.[level]?.glyphType;
        info.list = { key: p.bullet.listId, level, ordered: ORDERED_GLYPHS.has(glyph) };
        info.heading = undefined;
      }
      paras.push(info);
    }
    flushParas();
    return flushTo;
  };

  const body = convertElements(tab.body?.content ?? []);
  if (footnotes.length) {
    body.push({ type: "horizontalRule" });
    for (const fn of footnotes) {
      const blocks = convertElements(fn.content);
      const first = blocks[0];
      if (first?.type === "paragraph") {
        first.content = [{ type: "text", text: `[${fn.n}] ` }, ...(first.content ?? [])];
        body.push(...blocks);
      } else {
        body.push({ type: "paragraph", content: [{ type: "text", text: `[${fn.n}]` }] }, ...blocks);
      }
    }
  }
  return { type: "doc", content: body.length ? body : [{ type: "paragraph" }] };
}

/** Every embedded image (inline and floating) with its source URL, for the caller to fetch. */
export function googleDocImages(data: GDoc): { id: string; url: string }[] {
  const tab = googleDocTab(data);
  const out: { id: string; url: string }[] = [];
  for (const [kind, key] of [["inlineObjects", "inlineObjectProperties"], ["positionedObjects", "positionedObjectProperties"]] as const) {
    for (const [id, obj] of Object.entries(tab[kind] ?? {}) as [string, GDoc][]) {
      const url = obj?.[key]?.embeddedObject?.imageProperties?.contentUri;
      if (url) out.push({ id, url });
    }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Minimal XML parser (enough for WordprocessingML)
// ---------------------------------------------------------------------------

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: (XmlElement | string)[];
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: "#root", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const tag = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.children.push(decodeEntities(xml.slice(last, m.index)));
    last = tag.lastIndex;
    if (m[1] !== undefined) {
      top.children.push(m[1]);
    } else if (m[2]) {
      if (stack.length > 1 && top.name === m[2]) stack.pop();
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(m[4] ?? ""))) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? "");
      const el: XmlElement = { name: m[3], attrs, children: [] };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    }
  }
  return root;
}

const kids = (el: XmlElement | undefined, name?: string): XmlElement[] =>
  (el?.children ?? []).filter((c): c is XmlElement => typeof c !== "string" && (!name || c.name === name));
const kid = (el: XmlElement | undefined, name: string) => kids(el, name)[0];

function findAll(el: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of kids(el)) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

const textOf = (el: XmlElement): string =>
  el.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

/** <w:b/>, <w:b w:val="1"/> → true; <w:b w:val="0"/>, <w:b w:val="false"/> → false. */
function onOff(el: XmlElement | undefined): boolean {
  if (!el) return false;
  const v = el.attrs["w:val"];
  return v === undefined || !["0", "false", "off", "none"].includes(v);
}

// ---------------------------------------------------------------------------
// Word .docx
// ---------------------------------------------------------------------------

export interface DocxParts {
  /** word/document.xml */
  document: string;
  /** word/_rels/document.xml.rels */
  rels?: string;
  /** word/numbering.xml */
  numbering?: string;
  /** word/styles.xml */
  styles?: string;
}

const W_ALIGN: Record<string, Align> = { center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };

/** Relationship id → target ("media/image1.png" or an external URL). */
export function docxRelationships(relsXml: string | undefined): Map<string, { target: string; external: boolean }> {
  const map = new Map<string, { target: string; external: boolean }>();
  if (!relsXml) return map;
  for (const r of findAll(parseXml(relsXml), "Relationship")) {
    map.set(r.attrs.Id, { target: r.attrs.Target, external: r.attrs.TargetMode === "External" });
  }
  return map;
}

export function docxToTiptap(parts: DocxParts, opts: ImportOptions): DocNode {
  const rels = docxRelationships(parts.rels);

  // numId → (ilvl → ordered?)
  const ordered = new Map<string, Map<number, boolean>>();
  if (parts.numbering) {
    const numbering = parseXml(parts.numbering);
    const abstract = new Map<string, Map<number, boolean>>();
    for (const an of findAll(numbering, "w:abstractNum")) {
      const levels = new Map<number, boolean>();
      for (const lvl of kids(an, "w:lvl")) {
        const fmt = kid(lvl, "w:numFmt")?.attrs["w:val"] ?? "bullet";
        levels.set(Number(lvl.attrs["w:ilvl"] ?? 0), !["bullet", "none"].includes(fmt));
      }
      abstract.set(an.attrs["w:abstractNumId"], levels);
    }
    for (const num of findAll(numbering, "w:num")) {
      const abs = kid(num, "w:abstractNumId")?.attrs["w:val"];
      if (abs !== undefined) ordered.set(num.attrs["w:numId"], abstract.get(abs) ?? new Map());
    }
  }

  // styleId → heading level / numbering from the style
  const styleHeading = new Map<string, number>();
  const styleNum = new Map<string, { numId: string; ilvl: number }>();
  if (parts.styles) {
    for (const st of findAll(parseXml(parts.styles), "w:style")) {
      const id = st.attrs["w:styleId"];
      const name = (kid(st, "w:name")?.attrs["w:val"] ?? "").toLowerCase();
      const h = /^heading (\d)$/.exec(name);
      if (name === "title") styleHeading.set(id, 1);
      else if (name === "subtitle") styleHeading.set(id, 2);
      else if (h) styleHeading.set(id, Math.min(6, Number(h[1])));
      const numPr = kid(kid(st, "w:pPr"), "w:numPr");
      const numId = kid(numPr, "w:numId")?.attrs["w:val"];
      if (numId && numId !== "0") styleNum.set(id, { numId, ilvl: Number(kid(numPr, "w:ilvl")?.attrs["w:val"] ?? 0) });
    }
  }

  const runSegments = (run: XmlElement, link: DocMark | null): DocNode[] => {
    const rPr = kid(run, "w:rPr");
    const marks: DocMark[] = [];
    if (onOff(kid(rPr, "w:b"))) marks.push({ type: "bold" });
    if (onOff(kid(rPr, "w:i"))) marks.push({ type: "italic" });
    if (onOff(kid(rPr, "w:u")) && !link) marks.push({ type: "underline" });
    if (onOff(kid(rPr, "w:strike")) || onOff(kid(rPr, "w:dstrike"))) marks.push({ type: "strike" });
    if (link) marks.push(link);
    const out: DocNode[] = [];
    for (const c of kids(run)) {
      if (c.name === "w:t") {
        const n = textNode(textOf(c), marks);
        if (n) out.push(n);
      } else if (c.name === "w:tab") {
        const n = textNode("\t", marks);
        if (n) out.push(n);
      } else if (c.name === "w:br" || c.name === "w:cr") {
        if (!c.attrs["w:type"] || c.attrs["w:type"] === "textWrapping") out.push({ type: "hardBreak" });
      } else if (c.name === "w:drawing" || c.name === "w:pict") {
        for (const blip of [...findAll(c, "a:blip"), ...findAll(c, "v:imagedata")]) {
          const rid = blip.attrs["r:embed"] ?? blip.attrs["r:id"];
          const target = rid ? rels.get(rid) : undefined;
          const src = target && !target.external ? opts.imageSrc(target.target) : null;
          if (!src) continue;
          const attrs: Record<string, unknown> = { src };
          const extent = findAll(c, "wp:extent")[0];
          const cx = Number(extent?.attrs.cx);
          if (cx > 0) attrs.width = Math.round(cx / 9525);
          out.push({ type: "image", attrs });
        }
      }
    }
    return out;
  };

  const inlineSegments = (el: XmlElement, link: DocMark | null): DocNode[] => {
    const out: DocNode[] = [];
    for (const c of kids(el)) {
      if (c.name === "w:r") out.push(...runSegments(c, link));
      else if (c.name === "w:hyperlink") {
        const target = c.attrs["r:id"] ? rels.get(c.attrs["r:id"]) : undefined;
        const mark = target?.external ? linkMark(target.target, opts) : null;
        out.push(...inlineSegments(c, mark ?? link));
      } else if (["w:ins", "w:smartTag", "w:fldSimple", "w:customXml", "w:sdt", "w:sdtContent"].includes(c.name)) {
        out.push(...inlineSegments(c, link));
      }
    }
    return out;
  };

  const convertBody = (container: XmlElement): DocNode[] => {
    const out: DocNode[] = [];
    let paras: ParaInfo[] = [];
    const flush = () => {
      if (paras.length) out.push(...assembleBlocks(paras));
      paras = [];
    };
    for (const el of kids(container)) {
      if (el.name === "w:p") {
        const pPr = kid(el, "w:pPr");
        const styleId = kid(pPr, "w:pStyle")?.attrs["w:val"];
        const info: ParaInfo = {
          segments: inlineSegments(el, null),
          heading: styleId ? styleHeading.get(styleId) : undefined,
          align: W_ALIGN[kid(pPr, "w:jc")?.attrs["w:val"] ?? ""],
        };
        const numPr = kid(pPr, "w:numPr");
        const own = kid(numPr, "w:numId")?.attrs["w:val"];
        const fromStyle = styleId ? styleNum.get(styleId) : undefined;
        const numId = own ?? fromStyle?.numId;
        if (numId && numId !== "0") {
          const level = Number(kid(numPr, "w:ilvl")?.attrs["w:val"] ?? fromStyle?.ilvl ?? 0);
          info.list = { key: numId, level, ordered: ordered.get(numId)?.get(level) ?? false };
          info.heading = undefined;
        }
        paras.push(info);
      } else if (el.name === "w:tbl") {
        flush();
        const rows = kids(el, "w:tr").map((tr) => ({
          type: "tableRow",
          content: kids(tr, "w:tc").map((tc) => {
            const span = Number(kid(kid(tc, "w:tcPr"), "w:gridSpan")?.attrs["w:val"] ?? 1);
            const node: DocNode = { type: "tableCell", content: cellBlocks(convertBody(tc)) };
            if (span > 1) node.attrs = { colspan: span };
            return node;
          }),
        }));
        out.push({ type: "table", content: rows });
      } else if (el.name === "w:sdt") {
        flush();
        const inner = kid(el, "w:sdtContent");
        if (inner) out.push(...convertBody(inner));
      }
    }
    flush();
    return tidyBlocks(out);
  };

  const body = kid(kid(parseXml(parts.document), "w:document"), "w:body");
  const content = body ? convertBody(body) : [];
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** Media targets referenced by the document ("media/image1.png"). */
export function docxImageTargets(parts: DocxParts): string[] {
  const rels = docxRelationships(parts.rels);
  const doc = parseXml(parts.document);
  const ids = [...findAll(doc, "a:blip").map((b) => b.attrs["r:embed"]), ...findAll(doc, "v:imagedata").map((b) => b.attrs["r:id"])];
  return [...new Set(ids.map((id) => rels.get(id)).filter((r) => r && !r.external).map((r) => r!.target))];
}
