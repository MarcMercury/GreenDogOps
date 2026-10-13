import { describe, expect, it } from "vitest";
import { effectiveAttendance } from "./types";

const TODAY = "2026-10-13";
const a = (over: Partial<{ attendance_status: Parameters<typeof effectiveAttendance>[0]["attendance_status"]; work_date: string; removed_post_publish: boolean }> = {}) => ({
  attendance_status: "scheduled" as const,
  work_date: "2026-10-12",
  removed_post_publish: false,
  ...over,
});

describe("effectiveAttendance", () => {
  it("assumes present for an unmarked past shift when no time-clock grade is given (unchanged behaviour)", () => {
    expect(effectiveAttendance(a(), true, TODAY)).toBe("present");
  });
  it("uses the time-clock grade for an unmarked shift", () => {
    expect(effectiveAttendance(a(), true, TODAY, "absent")).toBe("absent");
    expect(effectiveAttendance(a(), true, TODAY, "late")).toBe("late");
    expect(effectiveAttendance(a({ work_date: TODAY }), true, TODAY, "scheduled")).toBe("scheduled");
  });
  it("never overrides a manager's mark", () => {
    expect(effectiveAttendance(a({ attendance_status: "absent_excused" }), true, TODAY, "absent")).toBe("absent_excused");
    expect(effectiveAttendance(a({ attendance_status: "present" }), true, TODAY, "absent")).toBe("present");
  });
  it("ignores grades for future, unpublished and removed shifts", () => {
    expect(effectiveAttendance(a({ work_date: "2026-10-20" }), true, TODAY, "absent")).toBe("scheduled");
    expect(effectiveAttendance(a(), false, TODAY, "absent")).toBe("scheduled");
    expect(effectiveAttendance(a({ removed_post_publish: true }), true, TODAY, "absent")).toBe("scheduled");
  });
});
