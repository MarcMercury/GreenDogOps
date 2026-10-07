import { describe, expect, it } from "vitest";
import { guessDocumentCategory } from "./document-category";

describe("guessDocumentCategory", () => {
  it("recognizes cover letters", () => {
    expect(guessDocumentCategory("Jane_Doe_Cover_Letter.pdf")).toBe("cover_letter");
    expect(guessDocumentCategory("CoverLetter.docx")).toBe("cover_letter");
    expect(guessDocumentCategory("letter-of-interest.pdf")).toBe("cover_letter");
  });

  it("recognizes resumes", () => {
    expect(guessDocumentCategory("Jane Résumé 2026.pdf", "other")).toBe("resume");
    expect(guessDocumentCategory("Jane_CV.pdf", "other")).toBe("resume");
  });

  it("recognizes other application documents", () => {
    expect(guessDocumentCategory("RVT_license.pdf")).toBe("license");
    expect(guessDocumentCategory("CPR-card.jpg")).toBe("certification");
    expect(guessDocumentCategory("reference letter.pdf")).toBe("reference");
  });

  it("falls back when the name is unrecognized", () => {
    expect(guessDocumentCategory("scan001.pdf")).toBe("resume");
    expect(guessDocumentCategory("scan001.pdf", "other")).toBe("other");
    expect(guessDocumentCategory("convert.pdf", "other")).toBe("other");
  });
});
