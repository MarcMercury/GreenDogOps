import { describe, expect, it } from "vitest";
import { selectDefaultWeek } from "@/features/scheduling/scheduling-grid/lib/select-default-week";

// Newest first, as getWeeks() returns them.
const weeks = [
  { id: "w3", week_start: "2026-10-18" },
  { id: "w2", week_start: "2026-10-11" },
  { id: "w1", week_start: "2026-10-04" },
];

describe("selectDefaultWeek", () => {
  it("prefers the current week", () => {
    expect(selectDefaultWeek(weeks, "2026-10-11")?.id).toBe("w2");
  });

  it("falls back to the most recent week on or before today", () => {
    expect(selectDefaultWeek(weeks, "2026-10-14")?.id).toBe("w2");
    expect(selectDefaultWeek(weeks, "2027-01-01")?.id).toBe("w3");
  });

  it("falls back to the last listed (earliest) week when every week is in the future", () => {
    expect(selectDefaultWeek(weeks, "2026-09-01")?.id).toBe("w1");
  });

  it("returns null when there are no weeks", () => {
    expect(selectDefaultWeek([], "2026-10-11")).toBeNull();
  });
});
