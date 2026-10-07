import { describe, expect, it } from "vitest";
import { cityFromZippopotam, formatCityState, normalizeUsZip } from "./zip";

describe("normalizeUsZip", () => {
  it("accepts 5-digit and ZIP+4 forms", () => {
    expect(normalizeUsZip("91335")).toBe("91335");
    expect(normalizeUsZip(" 91335-1234 ")).toBe("91335");
    expect(normalizeUsZip("913351234")).toBe("91335");
  });

  it("rejects partial or non-US codes", () => {
    expect(normalizeUsZip("9133")).toBeNull();
    expect(normalizeUsZip("K1A 0B1")).toBeNull();
    expect(normalizeUsZip("")).toBeNull();
    expect(normalizeUsZip(null)).toBeNull();
  });
});

describe("formatCityState", () => {
  it("joins city and state", () => {
    expect(formatCityState("Reseda", "CA")).toBe("Reseda, CA");
    expect(formatCityState("Reseda", null)).toBe("Reseda");
    expect(formatCityState("  ", "CA")).toBeNull();
  });
});

describe("cityFromZippopotam", () => {
  it("reads the first place", () => {
    expect(
      cityFromZippopotam({
        "post code": "91335",
        places: [{ "place name": "Reseda", "state abbreviation": "CA" }],
      }),
    ).toBe("Reseda, CA");
  });

  it("returns null for empty or malformed responses", () => {
    expect(cityFromZippopotam({})).toBeNull();
    expect(cityFromZippopotam({ places: [] })).toBeNull();
    expect(cityFromZippopotam(null)).toBeNull();
  });
});
