import { describe, expect, it } from "vitest";
import { formatHours } from "./hours";

describe("formatHours", () => {
  it("renders minutes as decimal hours with two places", () => {
    expect(formatHours(450)).toBe("7.50");
    expect(formatHours(480)).toBe("8.00");
    expect(formatHours(0)).toBe("0.00");
  });

  it("keeps the two places on fractional results", () => {
    expect(formatHours(45)).toBe("0.75");
    expect(formatHours(90)).toBe("1.50");
  });
});
