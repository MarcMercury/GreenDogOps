import { describe, expect, it } from "vitest";
import type { SchedAssignment, SchedWeekLine, ScheduleLocation } from "@/lib/schedule/types";
import { buildConflictReasons } from "@/features/scheduling/scheduling-grid/lib/conflict-reasons";

const lines: SchedWeekLine[] = [
  { id: "l1", week_id: "w", template_id: null, department_id: "d", role_id: null, label: null, start_time: "08:00", end_time: "12:00", sort_order: 0, is_adhoc: false },
  { id: "l2", week_id: "w", template_id: null, department_id: "d", role_id: null, label: null, start_time: "11:00", end_time: "15:00", sort_order: 1, is_adhoc: false },
  { id: "l3", week_id: "w", template_id: null, department_id: "d", role_id: null, label: null, start_time: "13:00", end_time: "17:00", sort_order: 2, is_adhoc: false },
];

const locations = [
  { id: "so", name: "Sherman Oaks", short_code: "SO" },
  { id: "ven", name: "Venice", short_code: null },
] as unknown as ScheduleLocation[];

function asg(id: string, lineId: string, locationId: string, personId = "p", day = 1): SchedAssignment {
  return {
    id,
    week_id: "w",
    line_id: lineId,
    location_id: locationId,
    person_id: personId,
    day_of_week: day,
    work_date: "2026-10-12",
    attendance_status: "scheduled",
    attendance_note: null,
    added_post_publish: false,
    removed_post_publish: false,
    changed_after_approval: false,
    auto_absent: false,
  };
}

describe("buildConflictReasons", () => {
  it("records a reason on both sides of an overlapping pair", () => {
    const reasons = buildConflictReasons([asg("a", "l1", "so"), asg("b", "l2", "ven")], lines, locations);
    expect(reasons.get("a")).toEqual(["Venice 11a–3p"]);
    expect(reasons.get("b")).toEqual(["SO 8a–12p"]);
  });

  it("ignores pairs on different days or for different people, and non-overlapping shifts", () => {
    const reasons = buildConflictReasons(
      [asg("a", "l1", "so"), asg("b", "l2", "so", "p", 2), asg("c", "l2", "so", "q"), asg("d", "l3", "so")],
      lines,
      locations,
    );
    expect(reasons.size).toBe(0);
  });

  it("falls back to 'another location' when the location is unknown", () => {
    const reasons = buildConflictReasons([asg("a", "l1", "so"), asg("b", "l2", "nowhere")], lines, locations);
    expect(reasons.get("a")).toEqual(["another location 11a–3p"]);
  });
});
