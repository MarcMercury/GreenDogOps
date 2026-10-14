import { describe, expect, it } from "vitest";
import { emptyTally } from "./tally";

describe("emptyTally", () => {
  it("starts every status and the total at zero", () => {
    expect(emptyTally()).toEqual({
      total: 0,
      present: 0,
      late: 0,
      late_excused: 0,
      absent: 0,
      absent_excused: 0,
      no_show: 0,
      pto: 0,
      scheduled: 0,
    });
  });

  it("returns a fresh object each call so two tallies never share counts", () => {
    const first = emptyTally();
    first.present += 1;
    expect(emptyTally().present).toBe(0);
  });
});
