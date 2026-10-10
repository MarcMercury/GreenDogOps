import { describe, expect, it } from "vitest";
import { optionsFromText, optionsTextFor } from "./qr";

describe("optionsFromText", () => {
  it("splits one option per line, trimming and dropping blanks", () => {
    expect(optionsFromText(" Free toy \n\nDiscount, 10%\n")).toEqual(["Free toy", "Discount, 10%"]);
  });

  it("caps at 50 options", () => {
    const text = Array.from({ length: 60 }, (_, i) => `o${i}`).join("\n");
    expect(optionsFromText(text)).toHaveLength(50);
  });
});

describe("optionsTextFor", () => {
  it("keeps a just-pressed Enter so a new option line can be typed", () => {
    const draft = "First option\n";
    expect(optionsTextFor(draft, optionsFromText(draft))).toBe(draft);
  });

  it("keeps a trailing space so multi-word options can be typed", () => {
    const draft = "Free ";
    expect(optionsTextFor(draft, optionsFromText(draft))).toBe(draft);
  });

  it("shows the saved options when they changed outside the textarea", () => {
    expect(optionsTextFor("A\nB\n", ["C", "D"])).toBe("C\nD");
    expect(optionsTextFor("", ["Yes", "No"])).toBe("Yes\nNo");
  });
});
