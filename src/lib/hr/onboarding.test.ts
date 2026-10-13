import { describe, expect, it } from "vitest";
import { completedOnboardingByPerson, ONBOARDING_ITEMS } from "./onboarding";

describe("completedOnboardingByPerson", () => {
  it("only counts items that have a completion date", () => {
    const result = completedOnboardingByPerson([
      { person_id: "p1", item_key: "offer_letter", completed_date: "2026-01-05" },
      { person_id: "p1", item_key: "handbook", completed_date: null },
      { person_id: "p1", item_key: "benefits", completed_date: "" },
      { person_id: "p2", item_key: "background_check", completed_date: "2026-02-01" },
    ]);
    expect(result).toEqual({
      p1: ["offer_letter"],
      p2: ["background_check"],
    });
  });

  it("ignores keys that are no longer in the catalog", () => {
    const result = completedOnboardingByPerson([
      { person_id: "p1", item_key: "retired_item", completed_date: "2026-01-05" },
    ]);
    expect(result).toEqual({});
  });

  it("gives every catalog item a non-empty column header", () => {
    for (const item of ONBOARDING_ITEMS) {
      expect((item.shortLabel ?? item.label).trim()).not.toBe("");
    }
  });
});
