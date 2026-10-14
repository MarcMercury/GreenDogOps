import { describe, expect, it } from "vitest";
import { selectTemplateId } from "./select-template";

const templates = [{ id: "a" }, { id: "b" }];

describe("selectTemplateId", () => {
  it("opens the requested template when it exists", () => {
    expect(selectTemplateId(templates, "b")).toBe("b");
  });

  it("falls back to the first template for a missing or unknown id", () => {
    expect(selectTemplateId(templates, undefined)).toBe("a");
    expect(selectTemplateId(templates, "deleted")).toBe("a");
    expect(selectTemplateId(templates, "")).toBe("a");
  });

  it("returns null when there are no templates", () => {
    expect(selectTemplateId([], "a")).toBeNull();
  });
});
