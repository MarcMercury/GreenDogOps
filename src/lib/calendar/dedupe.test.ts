import { describe, expect, it } from "vitest";
import { partitionNewEvents } from "./dedupe";

describe("partitionNewEvents", () => {
  it("skips events another calendar already stored, keeping the rest", () => {
    const rows = [{ google_event_id: "a" }, { google_event_id: "b" }, { google_event_id: "c" }];
    expect(partitionNewEvents(rows, new Set(["b"]))).toEqual({
      insert: [{ google_event_id: "a" }, { google_event_id: "c" }],
      shared: 1,
    });
  });

  it("inserts everything when nothing overlaps", () => {
    const rows = [{ google_event_id: "a" }];
    expect(partitionNewEvents(rows, new Set())).toEqual({ insert: rows, shared: 0 });
  });

  it("keeps one copy of an id repeated within the batch", () => {
    const rows = [
      { google_event_id: "a", title: "first" },
      { google_event_id: "a", title: "second" },
      { google_event_id: "b", title: "other" },
    ];
    expect(partitionNewEvents(rows, new Set())).toEqual({
      insert: [rows[0], rows[2]],
      shared: 1,
    });
  });
});
