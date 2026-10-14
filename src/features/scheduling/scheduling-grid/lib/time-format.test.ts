import { describe, expect, it } from "vitest";
import { formatClock, timeToMinutes } from "@/features/scheduling/scheduling-grid/lib/time-format";

describe("timeToMinutes", () => {
  it("parses HH:MM and HH:MM:SS into minutes since midnight", () => {
    expect(timeToMinutes("08:30")).toBe(510);
    expect(timeToMinutes("17:00:00")).toBe(1020);
    expect(timeToMinutes("00:00")).toBe(0);
  });

  it("returns null for missing or malformed times", () => {
    expect(timeToMinutes(null)).toBeNull();
    expect(timeToMinutes(undefined)).toBeNull();
    expect(timeToMinutes("")).toBeNull();
    expect(timeToMinutes("noon")).toBeNull();
  });
});

describe("formatClock", () => {
  it("renders the When I Work 12-hour style", () => {
    expect(formatClock("08:30")).toBe("8:30 AM");
    expect(formatClock("17:00:00")).toBe("5:00 PM");
    expect(formatClock("12:15")).toBe("12:15 PM");
    expect(formatClock("00:05")).toBe("12:05 AM");
  });

  it("returns an empty string for missing or malformed times", () => {
    expect(formatClock(null)).toBe("");
    expect(formatClock("")).toBe("");
    expect(formatClock("later")).toBe("");
  });
});
