import { describe, expect, it } from "vitest";
import type { SchedAssignment, SchedPerson, SchedRole, SchedWeekLine, ScheduleLocation } from "@/lib/schedule/types";
import { buildPerEmployeeShifts } from "@/features/scheduling/scheduling-grid/lib/per-employee-shifts";

const lines: SchedWeekLine[] = [
  { id: "l1", week_id: "w", template_id: null, department_id: "d", role_id: "r1", label: null, start_time: "08:00", end_time: "16:00", sort_order: 0, is_adhoc: false },
  { id: "l2", week_id: "w", template_id: null, department_id: "d", role_id: "r1", label: "Lead", start_time: "07:00", end_time: "15:00", sort_order: 1, is_adhoc: false },
];
const roles: SchedRole[] = [
  { id: "r1", department_id: "d", name: "Clinic Tech", sort_order: 0, is_active: true, created_at: "", updated_at: "" },
];
const locations = [{ id: "so", name: "Sherman Oaks" }] as unknown as ScheduleLocation[];
const people: SchedPerson[] = [
  { id: "p1", first_name: "Zoe", last_name: "Adams", grid_name: null, full_name: null },
  { id: "p2", first_name: "Al", last_name: "Baker", grid_name: null, full_name: null },
];
const personById = new Map(people.map((p) => [p.id, p]));
const base = {
  week_id: "w",
  attendance_status: "scheduled" as const,
  attendance_note: null,
  added_post_publish: false,
  removed_post_publish: false,
  changed_after_approval: false,
  auto_absent: false,
};

describe("buildPerEmployeeShifts", () => {
  it("groups active shifts per person, sorts shifts by date then start, and people by name", () => {
    const assignments: SchedAssignment[] = [
      { ...base, id: "a1", line_id: "l1", location_id: "so", person_id: "p1", day_of_week: 3, work_date: "2026-10-07" },
      { ...base, id: "a2", line_id: "l2", location_id: "so", person_id: "p1", day_of_week: 1, work_date: "2026-10-05" },
      { ...base, id: "a3", line_id: "l1", location_id: "so", person_id: "p1", day_of_week: 1, work_date: "2026-10-05" },
      { ...base, id: "a4", line_id: "l1", location_id: "nowhere", person_id: "p2", day_of_week: 2, work_date: "" },
      { ...base, id: "a5", line_id: "l1", location_id: "so", person_id: "p2", day_of_week: 4, work_date: "2026-10-08", removed_post_publish: true },
      { ...base, id: "a6", line_id: "l1", location_id: "so", person_id: "ghost", day_of_week: 4, work_date: "2026-10-08" },
    ];
    const out = buildPerEmployeeShifts({ assignments, lines, locations, roles, personById, weekStart: "2026-10-04" });
    expect(out.map((e) => e.person.id)).toEqual(["p2", "p1"]);
    expect(out[0].shifts).toEqual([
      { day: 2, date: "2026-10-06", start: "08:00", end: "16:00", location: "—", position: "Clinic Tech" },
    ]);
    expect(out[1].shifts.map((s) => [s.date, s.start, s.position])).toEqual([
      ["2026-10-05", "07:00", "Lead"],
      ["2026-10-05", "08:00", "Clinic Tech"],
      ["2026-10-07", "08:00", "Clinic Tech"],
    ]);
  });
});
