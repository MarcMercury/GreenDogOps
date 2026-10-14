import { describe, expect, it } from "vitest";
import type { SchedPerson } from "@/lib/schedule/types";
import type { AttendanceRow } from "@/features/scheduling/attendance/types/attendance-row";
import { rollupAttendanceByEmployee } from "./rollup";

// Dates far enough from "today" that the tests never flip as the calendar moves.
const PAST = "2020-03-02";
const FUTURE = "2999-01-01";

const person = (id: string, first_name: string): SchedPerson => ({
  id,
  first_name,
  last_name: null,
  grid_name: null,
  full_name: null,
});

let seq = 0;
const row = (
  p: SchedPerson | null,
  over: Partial<AttendanceRow["assignment"]> = {},
  published = true,
): AttendanceRow => ({
  assignment: {
    id: `a${++seq}`,
    week_id: "w1",
    person_id: p?.id ?? "nobody",
    work_date: PAST,
    attendance_status: "scheduled",
    removed_post_publish: false,
    ...over,
  },
  person: p,
  week_start: "2020-03-01",
  published,
});

describe("rollupAttendanceByEmployee", () => {
  const amy = person("p-amy", "Amy");

  it("counts a manager's mark, assumes Present for an unmarked past shift, and scores", () => {
    const [entry] = rollupAttendanceByEmployee(
      [row(amy, { attendance_status: "late" }), row(amy)],
      {},
    );
    expect(entry.personId).toBe("p-amy");
    expect(entry.name).toBe("Amy");
    expect(entry.tally).toMatchObject({ late: 1, present: 1, total: 2, scheduled: 0 });
    // late weighs 0.6, present 1 → (1.6 / 2) * 100
    expect(entry.score).toBe(80);
  });

  it("tallies a future shift as scheduled without resolving it", () => {
    const [entry] = rollupAttendanceByEmployee([row(amy, { work_date: FUTURE })], {});
    expect(entry.tally).toMatchObject({ scheduled: 1, total: 0 });
    expect(entry.score).toBeNull();
  });

  it("leaves a shift on an unpublished week unresolved", () => {
    const [entry] = rollupAttendanceByEmployee([row(amy, {}, false)], {});
    expect(entry.tally).toMatchObject({ scheduled: 1, present: 0, total: 0 });
  });

  it("uses the time-clock grade for an unmarked shift when one is given", () => {
    const r = row(amy);
    const [entry] = rollupAttendanceByEmployee([r], { [r.assignment.id]: "absent" });
    expect(entry.tally).toMatchObject({ absent: 1, present: 0, total: 1 });
    expect(entry.score).toBe(0);
  });

  it("skips rows whose person is unknown", () => {
    expect(rollupAttendanceByEmployee([row(null)], {})).toEqual([]);
  });

  it("orders at-risk employees first, then the unresolved by name", () => {
    const cal = person("p-cal", "Cal");
    const zed = person("p-zed", "Zed");
    const bea = person("p-bea", "Bea");
    const names = rollupAttendanceByEmployee(
      [
        row(zed, { work_date: FUTURE }), // nothing resolved
        row(cal, { attendance_status: "pto" }), // 100
        row(bea, { work_date: FUTURE }), // nothing resolved
        row(amy, { attendance_status: "late" }), // 60
      ],
      {},
    ).map((e) => e.name);
    expect(names).toEqual(["Amy", "Cal", "Bea", "Zed"]);
  });
});
