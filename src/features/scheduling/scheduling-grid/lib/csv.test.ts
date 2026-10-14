import { describe, expect, it } from "vitest";
import type { SchedAssignment, SchedPerson, SchedRole, SchedWeekLine, ScheduleLocation } from "@/lib/schedule/types";
import { buildWiwCsvRows, csvCell, csvDate, toCsvText } from "@/features/scheduling/scheduling-grid/lib/csv";

describe("csvDate", () => {
  it("formats ISO dates as M/D/YYYY", () => {
    expect(csvDate("2026-10-04")).toBe("10/4/2026");
  });
});

describe("csvCell", () => {
  it("quotes only cells that need it and doubles embedded quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });
});

describe("buildWiwCsvRows", () => {
  const lines: SchedWeekLine[] = [
    { id: "l1", week_id: "w", template_id: null, department_id: "d", role_id: "r1", label: null, start_time: "08:00", end_time: "16:30", sort_order: 0, is_adhoc: false },
    { id: "l2", week_id: "w", template_id: null, department_id: "d", role_id: null, label: "Float", start_time: null, end_time: null, sort_order: 1, is_adhoc: true },
  ];
  const roles: SchedRole[] = [
    { id: "r1", department_id: "d", name: "Clinic Tech", sort_order: 0, is_active: true, created_at: "", updated_at: "" },
  ];
  const locations = [
    { id: "ven", name: "Venice", sort_order: 20 },
    { id: "so", name: "Sherman Oaks", sort_order: 10 },
  ] as unknown as ScheduleLocation[];
  const people: SchedPerson[] = [
    { id: "p1", first_name: "Ana", last_name: "Zed", grid_name: null, full_name: null },
    { id: "p2", first_name: "Bo", last_name: "Lee", grid_name: "Bo L", full_name: null },
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
  const assignments: SchedAssignment[] = [
    { ...base, id: "a1", line_id: "l1", location_id: "ven", person_id: "p1", day_of_week: 2, work_date: "2026-10-06" },
    { ...base, id: "a2", line_id: "l1", location_id: "so", person_id: "p2", day_of_week: 1, work_date: "2026-10-05" },
    { ...base, id: "a3", line_id: "l2", location_id: "so", person_id: "p1", day_of_week: 3, work_date: "" },
    { ...base, id: "a4", line_id: "l1", location_id: "so", person_id: "p1", day_of_week: 1, work_date: "2026-10-05", removed_post_publish: true },
  ];

  it("groups by location order then employee, with blank separator rows, and skips removed shifts", () => {
    const rows = buildWiwCsvRows({ assignments, lines, roles, locations, personById, weekStart: "2026-10-04" });
    expect(rows).toEqual([
      ["Location", "Employee", "Day", "Date", "Start Time", "End Time", "Position"],
      ["Sherman Oaks", "Ana Zed", "Wednesday", "10/7/2026", "", "", "Float"],
      [],
      ["Sherman Oaks", "Bo L", "Monday", "10/5/2026", "8:00 AM", "4:30 PM", "Clinic Tech"],
      [],
      [],
      ["Venice", "Ana Zed", "Tuesday", "10/6/2026", "8:00 AM", "4:30 PM", "Clinic Tech"],
    ]);
  });

  it("serialises with CRLF line endings", () => {
    expect(toCsvText([["a", "b,c"], [], ["d"]])).toBe('a,"b,c"\r\n\r\nd');
  });
});
