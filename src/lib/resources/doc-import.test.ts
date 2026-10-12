import { describe, expect, it } from "vitest";
import { documentText, sanitizeDocument, type DocNode } from "./content";
import { docxImageTargets, docxToTiptap, googleDocImages, googleDocToTiptap, parseXml } from "./doc-import";

const run = (content: string, textStyle: Record<string, unknown> = {}) => ({ textRun: { content, textStyle } });
const para = (elements: unknown[], extra: Record<string, unknown> = {}) => ({
  paragraph: { elements, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, ...extra },
});

const gdoc = (content: unknown[], tab: Record<string, unknown> = {}) => ({
  tabs: [{ documentTab: { body: { content }, lists: {}, ...tab } }],
});

const noImages = { imageSrc: () => null };

describe("googleDocToTiptap", () => {
  it("converts headings, marks, alignment and soft breaks", () => {
    const out = googleDocToTiptap(
      gdoc([
        { sectionBreak: {} },
        para([run("Policy\n")], { paragraphStyle: { namedStyleType: "HEADING_2", alignment: "CENTER" } }),
        para([run("Be "), run("kind", { bold: true, italic: true }), run(" always\u000bnext\n")]),
      ]),
      noImages,
    );
    expect(out.content).toEqual([
      { type: "heading", attrs: { textAlign: "center", level: 2 }, content: [{ type: "text", text: "Policy" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Be " },
          { type: "text", text: "kind", marks: [{ type: "bold" }, { type: "italic" }] },
          { type: "text", text: " always" },
          { type: "hardBreak" },
          { type: "text", text: "next" },
        ],
      },
    ]);
  });

  it("nests bullet and numbered lists by level and list type", () => {
    const lists = {
      b: { listProperties: { nestingLevels: [{ glyphType: "GLYPH_TYPE_UNSPECIFIED", glyphSymbol: "●" }, { glyphType: "DECIMAL" }] } },
    };
    const out = googleDocToTiptap(
      gdoc(
        [
          para([run("one\n")], { bullet: { listId: "b" } }),
          para([run("one.a\n")], { bullet: { listId: "b", nestingLevel: 1 } }),
          para([run("two\n")], { bullet: { listId: "b" } }),
          para([run("after\n")]),
        ],
        { lists },
      ),
      noImages,
    );
    expect(documentText(out)).toBe("- one\n  1. one.a\n- two\n\nafter");
    expect(out.content![0].type).toBe("bulletList");
    expect(out.content![0].content![0].content![1].type).toBe("orderedList");
  });

  it("rewrites links, drops Google's link underline and keeps images and rules as blocks", () => {
    const out = googleDocToTiptap(
      gdoc(
        [
          para([
            { inlineObjectElement: { inlineObjectId: "img1" } },
            run("See "),
            run("this", { underline: true, link: { url: "https://docs.google.com/document/d/ABC/edit" } }),
            { horizontalRule: {} },
            run("\n"),
          ]),
        ],
        {
          inlineObjects: {
            img1: {
              inlineObjectProperties: {
                embeddedObject: { imageProperties: { contentUri: "https://lh7/x" }, size: { width: { magnitude: 75, unit: "PT" } } },
              },
            },
          },
        },
      ),
      { imageSrc: (id) => (id === "img1" ? "data:image/png;base64,AAAA" : null), rewriteLink: (u) => (u.includes("ABC") ? "/resources/doc/1" : u) },
    );
    expect(out.content).toEqual([
      { type: "image", attrs: { src: "data:image/png;base64,AAAA", width: 100 } },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          { type: "text", text: "this", marks: [{ type: "link", attrs: { href: "/resources/doc/1" } }] },
        ],
      },
      { type: "horizontalRule" },
    ]);
  });

  it("converts tables and appends footnotes", () => {
    const out = googleDocToTiptap(
      gdoc(
        [
          para([run("Rule"), { footnoteReference: { footnoteId: "f1", footnoteNumber: "1" } }, run("\n")]),
          {
            table: {
              tableRows: [
                { tableCells: [{ content: [para([run("A\n")])], tableCellStyle: { columnSpan: 2 } }] },
                { tableCells: [{ content: [para([run("\n")])] }, { content: [para([run("C\n")])] }] },
              ],
            },
          },
        ],
        { footnotes: { f1: { content: [para([run("Per state law.\n")])] } } },
      ),
      noImages,
    );
    const table = out.content![1];
    expect(table.content![0].content![0].attrs).toEqual({ colspan: 2 });
    expect(table.content![1].content![0].content).toEqual([{ type: "paragraph" }]);
    expect(documentText(out)).toBe("Rule[1]\n\nA\n | C\n\n[1] Per state law.");
  });

  it("lists every image for the caller to fetch", () => {
    const data = gdoc([], {
      inlineObjects: { a: { inlineObjectProperties: { embeddedObject: { imageProperties: { contentUri: "u1" } } } } },
      positionedObjects: { b: { positionedObjectProperties: { embeddedObject: { imageProperties: { contentUri: "u2" } } } } },
    });
    expect(googleDocImages(data)).toEqual([{ id: "a", url: "u1" }, { id: "b", url: "u2" }]);
  });

  it("produces documents the sanitizer keeps intact", () => {
    const out = googleDocToTiptap(gdoc([para([run("x", { bold: true })]), para([run("\n")]), para([run("\n")])]), noImages);
    expect(sanitizeDocument(out)).toEqual(out);
    expect(out.content).toHaveLength(1);
  });
});

const W = 'xmlns:w="w" xmlns:r="r"';
const wdoc = (body: string) => `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`;

describe("parseXml", () => {
  it("decodes entities and keeps preserved whitespace", () => {
    const root = parseXml('<a x="1 &amp; 2"><b xml:space="preserve"> A &lt;B&gt; &#39;c&#x27; </b><c/></a>');
    const a = root.children[0] as { attrs: Record<string, string>; children: unknown[] };
    expect(a.attrs.x).toBe("1 & 2");
    expect((a.children[0] as { children: string[] }).children[0]).toBe(" A <B> 'c' ");
  });
});

describe("docxToTiptap", () => {
  const styles = `<w:styles ${W}>
    <w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
    <w:style w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:style>
  </w:styles>`;
  const numbering = `<w:numbering ${W}>
    <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
    <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
    <w:num w:numId="3"><w:abstractNumId w:val="0"/></w:num>
    <w:num w:numId="7"><w:abstractNumId w:val="1"/></w:num>
  </w:numbering>`;
  const rels = `<Relationships>
    <Relationship Id="rId5" Target="https://gdd.example/form" TargetMode="External"/>
    <Relationship Id="rId9" Target="media/image1.png"/>
  </Relationships>`;

  it("converts headings, runs, numbering, style numbering and hyperlinks", () => {
    const document = wdoc(`
      <w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:t>Attendance</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Call out </w:t></w:r><w:r><w:rPr><w:b w:val="0"/><w:i/></w:rPr><w:t>early</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>Text your manager</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>Before 7am</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:hyperlink r:id="rId5"><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Form</w:t></w:r></w:hyperlink></w:p>
      <w:p><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:t>Line</w:t><w:br/><w:t>two</w:t><w:br w:type="page"/></w:r></w:p>`);
    const out = docxToTiptap({ document, styles, numbering, rels }, noImages);
    expect(out.content![0]).toEqual({ type: "heading", attrs: { textAlign: "center", level: 1 }, content: [{ type: "text", text: "Attendance" }] });
    expect(out.content![1].content).toEqual([
      { type: "text", text: "Call out ", marks: [{ type: "bold" }] },
      { type: "text", text: "early", marks: [{ type: "italic" }] },
    ]);
    expect(documentText(out)).toBe("Attendance\n\nCall out early\n\n1. Text your manager\n  - Before 7am\n\n- Form\n\nLine\ntwo");
    const link = out.content![3].content![0].content![0].content![0];
    expect(link.marks).toEqual([{ type: "link", attrs: { href: "https://gdd.example/form" } }]);
  });

  it("converts tables with spans and embedded images", () => {
    const document = wdoc(`
      <w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Head</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r><w:drawing><wp:inline xmlns:wp="wp"><wp:extent cx="952500" cy="10"/><a:graphic xmlns:a="a"><a:blip r:embed="rId9"/></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
    expect(docxImageTargets({ document, rels })).toEqual(["media/image1.png"]);
    const out = docxToTiptap({ document, rels }, { imageSrc: (t) => (t === "media/image1.png" ? "data:image/png;base64,AA==" : null) });
    expect(out.content![0].content![0].content![0].attrs).toEqual({ colspan: 2 });
    expect(out.content![1]).toEqual({ type: "image", attrs: { src: "data:image/png;base64,AA==", width: 100 } } satisfies DocNode);
  });
});
