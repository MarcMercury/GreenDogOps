import { describe, expect, it } from "vitest";
import type { SchedPerson } from "@/lib/schedule/types";
import { buildPtoByDay } from "@/features/scheduling/scheduling-grid/lib/pto-by-day";

const people: SchedPerson[] = [
  { id: "p1", first_name: "Zoe", last_name: "Adams", grid_name: null, full_name: null },
  { id: "p2", first_name: "Al", last_name: "Baker", grid_name: null, full_name: null },
];
const personById = new Map(people.map((p) => [p.id, p]));

describe("buildPtoByDay", () => {
  it("expands each request across the days of the week it overlaps, sorted by name", () => {
    const out = buildPtoByDay(
      [
        { id: "t1", person_id: "p1", status: "approved", start_date: "2026-10-05", end_date: "2026-10-06" },
        { id: "t2", person_id: "p2", status: "requested", start_date: "2026-10-01", end_date: "2026-10-05" },
      ],
      personById,
      "2026-10-04",
    );
    // t2 runs Oct 1–5, so it also lands on Sunday Oct 4 (day 0) of this week.
    expect([...out.keys()].sort()).toEqual([0, 1, 2]);
    expect(out.get(0)!.map((c) => c.person.id)).toEqual(["p2"]);
    expect(out.get(1)!.map((c) => [c.person.id, c.status, c.requestId])).toEqual([
      ["p2", "requested", "t2"],
      ["p1", "approved", "t1"],
    ]);
    expect(out.get(2)!.map((c) => c.person.id)).toEqual(["p1"]);
  });

  it("ignores denied requests, unknown people and requests outside the week", () => {
    const out = buildPtoByDay(
      [
        { id: "t1", person_id: "p1", status: "denied", start_date: "2026-10-05", end_date: "2026-10-05" },
        { id: "t2", person_id: "ghost", status: "approved", start_date: "2026-10-05", end_date: "2026-10-05" },
        { id: "t3", person_id: "p2", status: "approved", start_date: "2026-10-20", end_date: "2026-10-21" },
      ],
      personById,
      "2026-10-04",
    );
    expect(out.size).toBe(0);
  });
});
