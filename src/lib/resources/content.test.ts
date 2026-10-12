import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk-text";
import {
  documentText,
  isEmptyDocument,
  isSafeHref,
  isSafeImageSrc,
  sanitizeDocument,
  type DocNode,
} from "./content";

const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const t = (text: string, marks?: DocNode["marks"]): DocNode => (marks ? { type: "text", text, marks } : { type: "text", text });

describe("sanitizeDocument", () => {
  it("rejects anything that is not a document", () => {
    expect(sanitizeDocument(null)).toBeNull();
    expect(sanitizeDocument("<p>hi</p>")).toBeNull();
    expect(sanitizeDocument({ type: "paragraph" })).toBeNull();
  });

  it("keeps supported structure and formatting", () => {
    const input = doc(
      { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [t("Title")] },
      p(t("bold", [{ type: "bold" }]), t(" link", [{ type: "link", attrs: { href: "https://x.org", target: "_blank" } }])),
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(t("three"))] }] },
    );
    const out = sanitizeDocument(input)!;
    expect(out.content![0]).toEqual({ type: "heading", attrs: { level: 2, textAlign: "center" }, content: [t("Title")] });
    expect(out.content![1].content![1].marks).toEqual([{ type: "link", attrs: { href: "https://x.org" } }]);
    expect(out.content![2].attrs).toEqual({ start: 3 });
  });

  it("drops script links but keeps their text", () => {
    const out = sanitizeDocument(doc(p(t("click", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))))!;
    expect(out.content![0].content![0]).toEqual(t("click"));
  });

  it("drops unknown nodes, marks and attributes", () => {
    const out = sanitizeDocument(
      doc(
        { type: "iframe", attrs: { src: "https://evil" } } as DocNode,
        p(t("x", [{ type: "textStyle", attrs: { style: "x" } }])),
        { type: "paragraph", attrs: { onclick: "x", textAlign: "sideways" }, content: [t("y")] },
      ),
    )!;
    expect(out.content).toEqual([p(t("x")), p(t("y"))]);
  });

  it("only allows raster data images and https images", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const ok = sanitizeDocument(doc({ type: "image", attrs: { src: png, alt: "logo" } }))!;
    expect(ok.content![0].attrs).toEqual({ src: png, alt: "logo" });
    for (const src of ["data:image/svg+xml;base64,PHN2Zz4=", "javascript:x", "http://plain.org/a.png"]) {
      expect(sanitizeDocument(doc({ type: "image", attrs: { src } }))!.content).toEqual([{ type: "paragraph" }]);
    }
  });

  it("never returns an empty document body", () => {
    expect(sanitizeDocument({ type: "doc" })).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});

describe("isSafeHref / isSafeImageSrc", () => {
  it("allows web, mail, phone and in-app links only", () => {
    for (const ok of ["https://a.b", "http://a.b", "mailto:x@y.z", "tel:+1555", "/resources/doc/1", "#top"]) {
      expect(isSafeHref(ok)).toBe(true);
    }
    for (const bad of ["javascript:x", "JAVASCRIPT:x", "//evil.com", "/\\evil.com", "data:text/html,x", "vbscript:x", ""]) {
      expect(isSafeHref(bad)).toBe(false);
    }
  });
  it("rejects oversized inline images", () => {
    expect(isSafeImageSrc(`data:image/png;base64,${"A".repeat(5_000_000)}`)).toBe(false);
  });
});

describe("documentText", () => {
  it("renders blocks, nested lists and tables as plain text", () => {
    const d = doc(
      { type: "heading", attrs: { level: 1 }, content: [t("Policy")] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              p(t("first")),
              { type: "orderedList", content: [{ type: "listItem", content: [p(t("nested"))] }] },
            ],
          },
          { type: "listItem", content: [p(t("second"))] },
        ],
      },
      {
        type: "table",
        content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p(t("A"))] }, { type: "tableCell", content: [p(t("B"))] }] }],
      },
      p(t("line"), { type: "hardBreak" }, t("break")),
    );
    expect(documentText(d)).toBe("Policy\n\n- first\n  1. nested\n- second\n\nA | B\n\nline\nbreak");
  });

  it("feeds the shared chunker", () => {
    const text = documentText(doc(...Array.from({ length: 40 }, (_, i) => p(t(`Paragraph ${i} `.repeat(10))))));
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1500 + 200)).toBe(true);
  });
});

describe("isEmptyDocument", () => {
  it("treats whitespace-only documents as empty", () => {
    expect(isEmptyDocument(doc(p(t("  "))))).toBe(true);
    expect(isEmptyDocument(doc(p(t("x"))))).toBe(false);
    expect(isEmptyDocument(doc({ type: "image", attrs: { src: "https://a/b.png" } }))).toBe(false);
  });
});
