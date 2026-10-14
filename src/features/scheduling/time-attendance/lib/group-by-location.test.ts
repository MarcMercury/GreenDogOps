import { describe, expect, it } from "vitest";
import { groupByLocation } from "@/features/scheduling/time-attendance/lib/group-by-location";

const at = (location_id: string, location_name: string, person: string) => ({
  shift: { location_id, location_name },
  person,
});

describe("groupByLocation", () => {
  it("groups rows by location id and orders the groups by clinic name", () => {
    const groups = groupByLocation([
      at("ven", "Venice", "Ana"),
      at("so", "Sherman Oaks", "Ben"),
      at("ven", "Venice", "Cy"),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Sherman Oaks", "Venice"]);
    expect(groups.map((g) => g.id)).toEqual(["so", "ven"]);
    expect(groups[1].rows.map((r) => r.person)).toEqual(["Ana", "Cy"]);
  });

  it("names a group after the first shift seen for that location", () => {
    const groups = groupByLocation([at("so", "Sherman Oaks", "Ana"), at("so", "SO (renamed)", "Ben")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Sherman Oaks");
    expect(groups[0].rows).toHaveLength(2);
  });

  it("returns no groups for an empty day", () => {
    expect(groupByLocation([])).toEqual([]);
  });
});
