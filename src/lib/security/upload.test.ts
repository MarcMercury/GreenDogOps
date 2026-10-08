import { describe, expect, it } from "vitest";
import {
  FALLBACK_CONTENT_TYPE,
  fileExtension,
  isSafeImageUpload,
  safeUploadContentType,
} from "./upload";

describe("fileExtension", () => {
  it("lower-cases and strips the dot", () => {
    expect(fileExtension("Resume.PDF")).toBe("pdf");
    expect(fileExtension("archive.tar.gz")).toBe("gz");
  });
  it("returns empty for names without a usable extension", () => {
    expect(fileExtension("resume")).toBe("");
    expect(fileExtension(".env")).toBe("");
    expect(fileExtension("trailing.")).toBe("");
    expect(fileExtension(null)).toBe("");
  });
});

describe("safeUploadContentType", () => {
  it("maps common document and image types by extension", () => {
    expect(safeUploadContentType("cv.pdf", "text/html")).toBe("application/pdf");
    expect(safeUploadContentType("cv.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(safeUploadContentType("photo.JPG")).toBe("image/jpeg");
  });

  it("never stores renderable markup or scripts under their own type", () => {
    for (const name of ["x.html", "x.htm", "x.svg", "x.xml", "x.js", "x.xhtml", "x.exe"]) {
      expect(safeUploadContentType(name, "text/html")).toBe(FALLBACK_CONTENT_TYPE);
    }
  });

  it("keeps a supplied type only when it is on the safe list", () => {
    expect(safeUploadContentType("resume", "application/pdf")).toBe("application/pdf");
    expect(safeUploadContentType("resume", "application/pdf; name=x")).toBe("application/pdf");
    expect(safeUploadContentType("resume", "image/svg+xml")).toBe(FALLBACK_CONTENT_TYPE);
    expect(safeUploadContentType("resume", "text/html")).toBe(FALLBACK_CONTENT_TYPE);
    expect(safeUploadContentType("resume", null)).toBe(FALLBACK_CONTENT_TYPE);
  });

  it("an unrecognised extension can only ever become a safe type", () => {
    expect(safeUploadContentType("evil.html", "application/pdf")).toBe("application/pdf");
    expect(safeUploadContentType("evil.svg", "image/png")).toBe("image/png");
  });
});

describe("isSafeImageUpload", () => {
  it("accepts raster images and rejects svg/html", () => {
    expect(isSafeImageUpload("banner.png")).toBe(true);
    expect(isSafeImageUpload("banner.svg")).toBe(false);
    expect(isSafeImageUpload("banner.html", "text/html")).toBe(false);
  });
});
