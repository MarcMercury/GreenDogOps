import { describe, expect, it } from "vitest";
import {
  basicRequirementsFrom,
  checkBasicAnswers,
  DEFAULT_BASIC_REQUIREMENTS,
  optionsFromText,
  optionsTextFor,
} from "./qr";

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

describe("basicRequirementsFrom", () => {
  it("requires email and phone when there is no live form", () => {
    expect(basicRequirementsFrom(null)).toEqual({
      email: true,
      phone: true,
      petName: false,
      zip: false,
    });
  });

  it("only requires pet name / ZIP while the form asks for them", () => {
    const base = { require_pet_name: true, require_zip: true };
    expect(basicRequirementsFrom({ ...base, collect_pet_name: false, collect_zip: false })).toMatchObject({
      petName: false,
      zip: false,
    });
    expect(basicRequirementsFrom({ ...base, collect_pet_name: true, collect_zip: true })).toMatchObject({
      petName: true,
      zip: true,
    });
  });

  it("honours an editor turning email / phone off", () => {
    expect(basicRequirementsFrom({ require_email: false, require_phone: false })).toMatchObject({
      email: false,
      phone: false,
    });
  });
});

describe("checkBasicAnswers", () => {
  const full = {
    fullName: "Pat Doe",
    email: "pat@example.com",
    phone: "(310) 555-0100",
    petName: "Rex",
    zip: "90291",
  };
  const all = { email: true, phone: true, petName: true, zip: true };

  it("accepts a complete submission", () => {
    expect(checkBasicAnswers(all, full)).toBeNull();
  });

  it("rejects each missing required field", () => {
    expect(checkBasicAnswers(all, { ...full, fullName: null })).toMatch(/name/);
    expect(checkBasicAnswers(all, { ...full, email: null })).toMatch(/email/);
    expect(checkBasicAnswers(all, { ...full, phone: null })).toMatch(/phone/);
    expect(checkBasicAnswers(all, { ...full, petName: null })).toMatch(/pet/);
    expect(checkBasicAnswers(all, { ...full, zip: null })).toMatch(/ZIP/);
  });

  it("rejects a name-only lead under the default rules", () => {
    expect(
      checkBasicAnswers(DEFAULT_BASIC_REQUIREMENTS, {
        ...full,
        email: null,
        phone: null,
        petName: null,
        zip: null,
      }),
    ).not.toBeNull();
  });

  it("still needs one way to reach the person when neither is required", () => {
    const loose = { email: false, phone: false, petName: false, zip: false };
    expect(checkBasicAnswers(loose, { ...full, email: null, phone: null })).toMatch(/email or phone/);
    expect(checkBasicAnswers(loose, { ...full, phone: null })).toBeNull();
  });

  it("does not let junk satisfy a required phone", () => {
    expect(checkBasicAnswers(all, { ...full, phone: "x" })).toMatch(/valid phone/);
  });
});
