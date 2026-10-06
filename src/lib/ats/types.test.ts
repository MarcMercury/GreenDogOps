import { describe, expect, it } from "vitest";
import { formatDaysNeeded, formatPayRange, formatShift } from "./types";

describe("formatDaysNeeded", () => {
  it("returns null when no days are set", () => {
    expect(formatDaysNeeded([])).toBeNull();
    expect(formatDaysNeeded(null)).toBeNull();
  });

  it("collapses common patterns", () => {
    expect(formatDaysNeeded([1, 2, 3, 4, 5])).toBe("Mon–Fri");
    expect(formatDaysNeeded([6, 0])).toBe("Sat, Sun");
    expect(formatDaysNeeded([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
  });

  it("lists other days Monday-first", () => {
    expect(formatDaysNeeded([0, 5, 1, 3])).toBe("Mon, Wed, Fri, Sun");
  });
});

describe("formatPayRange", () => {
  it("formats hourly and salary ranges", () => {
    expect(formatPayRange({ pay_min: 22, pay_max: 28, pay_type: "hourly" })).toBe("$22–$28/hr");
    expect(formatPayRange({ pay_min: 85000, pay_max: 110000, pay_type: "salary" })).toBe(
      "$85k–$110k/yr",
    );
    expect(formatPayRange({ pay_min: 22.5, pay_max: 22.5, pay_type: "hourly" })).toBe("$22.5/hr");
  });

  it("handles open-ended ranges", () => {
    expect(formatPayRange({ pay_min: 25, pay_max: null, pay_type: "hourly" })).toBe("From $25/hr");
    expect(formatPayRange({ pay_min: null, pay_max: 30, pay_type: "hourly" })).toBe("Up to $30/hr");
    expect(formatPayRange({ pay_min: null, pay_max: null, pay_type: "hourly" })).toBeNull();
  });
});

describe("formatShift", () => {
  it("formats start and end times", () => {
    expect(formatShift("08:00:00", "18:30:00")).toBe("8:00 AM – 6:30 PM");
    expect(formatShift("07:00", null)).toBe("Starts 7:00 AM");
    expect(formatShift(null, null)).toBeNull();
  });
});
