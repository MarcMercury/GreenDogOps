import { describe, expect, it } from "vitest";
import { formatShiftTime, localMinutes, pickShift } from "./shift-match";

const s = (id: string, start: string | null) => ({ assignment_id: id, location_id: "L", start_time: start, end_time: null });

describe("pickShift", () => {
  it("returns null with no shifts (unscheduled work is allowed)", () => {
    expect(pickShift([], 480)).toBeNull();
  });
  it("picks the shift starting nearest to now", () => {
    const shifts = [s("am", "08:00:00"), s("pm", "14:00:00")];
    expect(pickShift(shifts, 7 * 60 + 50)?.assignment_id).toBe("am");
    expect(pickShift(shifts, 13 * 60 + 40)?.assignment_id).toBe("pm");
  });
  it("prefers a timed shift over one with no start time", () => {
    expect(pickShift([s("untimed", null), s("timed", "09:00:00")], 6 * 60)?.assignment_id).toBe("timed");
    expect(pickShift([s("untimed", null)], 6 * 60)?.assignment_id).toBe("untimed");
  });
});

describe("time helpers", () => {
  it("reads the clinic-local time of day across DST", () => {
    expect(localMinutes(new Date("2026-10-13T15:02:00Z"), "America/Los_Angeles")).toBe(8 * 60 + 2); // PDT
    expect(localMinutes(new Date("2026-12-13T16:02:00Z"), "America/Los_Angeles")).toBe(8 * 60 + 2); // PST
  });
  it("formats shift times", () => {
    expect(formatShiftTime("08:00:00")).toBe("8:00 AM");
    expect(formatShiftTime("12:30:00")).toBe("12:30 PM");
    expect(formatShiftTime("00:15:00")).toBe("12:15 AM");
    expect(formatShiftTime(null)).toBeNull();
  });
});
