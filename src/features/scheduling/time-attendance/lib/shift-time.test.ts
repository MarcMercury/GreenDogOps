import { describe, expect, it } from "vitest";
import { shiftTime } from "@/features/scheduling/time-attendance/lib/shift-time";

describe("shiftTime", () => {
  it("prints the shift window in 12-hour time", () => {
    expect(shiftTime({ start_time: "08:00:00", end_time: "17:30:00" })).toBe("8:00 AM – 5:30 PM");
  });

  it("prints only the start when the line has no end time", () => {
    expect(shiftTime({ start_time: "08:00:00", end_time: null })).toBe("8:00 AM");
  });

  it("says so when the line has no start time", () => {
    expect(shiftTime({ start_time: null, end_time: null })).toBe("No time set");
    expect(shiftTime({ start_time: null, end_time: "17:00:00" })).toBe("No time set");
  });
});
