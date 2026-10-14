import { describe, expect, it } from "vitest";
import {
  defaultEligibleLocationIds,
  effectiveEligibleLocationIds,
} from "./default-eligible-locations";

describe("defaultEligibleLocationIds", () => {
  it("includes every location except MPMV, matching by short code or name", () => {
    expect(
      defaultEligibleLocationIds([
        { id: "so", name: "Sherman Oaks", short_code: "SO" },
        { id: "mp", name: "Mobile", short_code: "mpmv" },
        { id: "van", name: "MPMV", short_code: null },
        { id: "ven", name: "Venice", short_code: null },
      ]),
    ).toEqual(["so", "ven"]);
  });
});

describe("effectiveEligibleLocationIds", () => {
  const defaults = ["so", "ven"];

  it("lights nothing for someone who is not schedulable, even with a saved list", () => {
    expect(
      effectiveEligibleLocationIds(
        { is_schedulable: false, eligible_location_ids: ["so"] },
        defaults,
      ),
    ).toEqual([]);
    expect(effectiveEligibleLocationIds(undefined, defaults)).toEqual([]);
  });

  it("uses the saved list when there is one, else the default", () => {
    expect(
      effectiveEligibleLocationIds(
        { is_schedulable: true, eligible_location_ids: ["van"] },
        defaults,
      ),
    ).toEqual(["van"]);
    expect(
      effectiveEligibleLocationIds(
        { is_schedulable: true, eligible_location_ids: [] },
        defaults,
      ),
    ).toBe(defaults);
  });
});
