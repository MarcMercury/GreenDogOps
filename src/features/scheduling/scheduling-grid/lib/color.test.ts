import { describe, expect, it } from "vitest";
import { parseHex, tintOf } from "@/features/scheduling/scheduling-grid/lib/color";

describe("tintOf", () => {
  it("mixes a hex colour towards white, opaque", () => {
    expect(tintOf("#000000", 0.5)).toBe("rgb(128, 128, 128)");
    expect(tintOf("#ff0000", 0.12)).toBe("rgb(255, 224, 224)");
    expect(tintOf("#abc", 1)).toBe("rgb(170, 187, 204)");
  });

  it("falls back to a slate tint for a value that is not a hex colour", () => {
    expect(tintOf("rebeccapurple")).toBe("rgba(100, 116, 139, 0.12)");
    expect(parseHex("nope")).toBeNull();
  });
});
