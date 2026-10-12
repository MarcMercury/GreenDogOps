import { describe, expect, it } from "vitest";
import { safeHref, tokenizeInline } from "./ziggy-markdown";

describe("tokenizeInline", () => {
  it("turns a markdown Sources link into a link token", () => {
    const url =
      "https://docs.google.com/document/d/10WHDG-7kplVDYcQa4MDfLLZqsJHeyQF1/edit?usp=drivesdk&ouid=108563212199504697168&rtpof=true&sd=true";
    expect(tokenizeInline(`[Green Dog Safety and Best Practice Handbook](${url})`)).toEqual([
      { type: "link", text: "Green Dog Safety and Best Practice Handbook", href: url },
    ]);
  });

  it("leaves plain titles as text", () => {
    expect(tokenizeInline("Green Dog HR Guide")).toEqual([
      { type: "text", text: "Green Dog HR Guide" },
    ]);
  });

  it("links bare URLs without swallowing trailing punctuation", () => {
    expect(tokenizeInline("See https://example.com/a?b=1.")).toEqual([
      { type: "text", text: "See " },
      { type: "link", text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { type: "text", text: "." },
    ]);
  });

  it("still handles bold and code alongside links", () => {
    expect(tokenizeInline("**Sources** `x` [Doc](https://example.com/d)")).toEqual([
      { type: "bold", text: "Sources" },
      { type: "text", text: " " },
      { type: "code", text: "x" },
      { type: "text", text: " " },
      { type: "link", text: "Doc", href: "https://example.com/d" },
    ]);
  });

  it("never produces non-http links", () => {
    expect(tokenizeInline("[click](javascript:alert(1))")).toEqual([
      { type: "text", text: "[click](javascript:alert(1))" },
    ]);
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("not a url")).toBeNull();
  });
});
