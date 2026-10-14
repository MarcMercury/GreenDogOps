import { describe, expect, it } from "vitest";
import type { SchedAssignment, SchedWeekLine } from "@/lib/schedule/types";
import { assignmentsOverlap } from "@/features/scheduling/scheduling-grid/lib/assignments-overlap";

function line(id: string, start: string | null, end: string | null): SchedWeekLine {
  return {
    id,
    week_id: "w",
    template_id: null,
    department_id: "d",
    role_id: null,
    label: null,
    start_time: start,
    end_time: end,
    sort_order: 0,
    is_adhoc: false,
  };
}

function asg(id: string, lineId: string, locationId: string): SchedAssignment {
  return {
    id,
    week_id: "w",
    line_id: lineId,
    location_id: locationId,
    person_id: "p",
    day_of_week: 1,
    work_date: "2026-10-12",
    attendance_status: "scheduled",
    attendance_note: null,
    added_post_publish: false,
    removed_post_publish: false,
    changed_after_approval: false,
    auto_absent: false,
  };
}

const lines = new Map<string, SchedWeekLine>([
  ["morning", line("morning", "08:00", "12:00")],
  ["midday", line("midday", "11:00", "15:00")],
  ["afternoon", line("afternoon", "12:00", "17:00")],
  ["untimed", line("untimed", null, null)],
]);

describe("assignmentsOverlap", () => {
  it("treats the same shift line as a collision (exact duplicate)", () => {
    expect(assignmentsOverlap(asg("a", "morning", "SO"), asg("b", "morning", "VEN"), lines)).toBe(true);
  });

  it("flags overlapping time windows on different lines", () => {
    expect(assignmentsOverlap(asg("a", "morning", "SO"), asg("b", "midday", "SO"), lines)).toBe(true);
  });

  it("does not flag back-to-back shifts (half-open intervals)", () => {
    expect(assignmentsOverlap(asg("a", "morning", "SO"), asg("b", "afternoon", "SO"), lines)).toBe(false);
  });

  it("with unknown times, flags only cross-location double-bookings", () => {
    expect(assignmentsOverlap(asg("a", "untimed", "SO"), asg("b", "morning", "SO"), lines)).toBe(false);
    expect(assignmentsOverlap(asg("a", "untimed", "SO"), asg("b", "morning", "VEN"), lines)).toBe(true);
  });
});
