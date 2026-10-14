import { describe, expect, it } from "vitest";
import type { SchedAssignment } from "@/lib/schedule/types";
import { summarizePersonAttendance } from "./person-attendance";

const PAST = "2020-03-02";
const FUTURE = "2999-01-01";

let seq = 0;
const asg = (over: Partial<SchedAssignment> = {}): SchedAssignment => ({
  id: `a${++seq}`,
  week_id: "w-pub",
  line_id: "l1",
  location_id: "loc-full",
  person_id: "p1",
  day_of_week: 1,
  work_date: PAST,
  attendance_status: "scheduled",
  attendance_note: null,
  added_post_publish: false,
  removed_post_publish: false,
  changed_after_approval: false,
  auto_absent: false,
  ...over,
});

const weeks = [
  { id: "w-pub", week_start: "2020-03-01", status: "published" },
  { id: "w-draft", week_start: "2020-03-08", status: "draft" },
];

const locations = [
  { id: "loc-full", name: "Venice", display_name: "Venice Clinic", short_code: "VEN" },
  { id: "loc-name", name: "Sherman Oaks", display_name: null, short_code: "SO" },
  { id: "loc-code", name: null, display_name: null, short_code: "VAN" },
  { id: "loc-blank", name: null, display_name: null, short_code: null },
];

describe("summarizePersonAttendance", () => {
  it("lists an unmarked past shift on a published week as Present, with the week and clinic", () => {
    const s = summarizePersonAttendance([asg()], weeks, locations, {});
    expect(s.tally).toMatchObject({ present: 1, total: 1, scheduled: 0 });
    expect(s.score).toBe(100);
    expect(s.records).toEqual([
      expect.objectContaining({
        status: "present",
        work_date: PAST,
        week_start: "2020-03-01",
        location_name: "Venice Clinic",
        note: null,
        auto_absent: false,
      }),
    ]);
  });

  it("tallies but does not list shifts that are still scheduled (draft week, future day, unknown week)", () => {
    const s = summarizePersonAttendance(
      [asg({ week_id: "w-draft" }), asg({ work_date: FUTURE }), asg({ week_id: "w-missing" })],
      weeks,
      locations,
      {},
    );
    expect(s.tally).toMatchObject({ scheduled: 3, total: 0 });
    expect(s.score).toBeNull();
    expect(s.records).toEqual([]);
  });

  it("a manager's mark resolves a shift even on a draft week, carrying the note and auto-absence flag", () => {
    const s = summarizePersonAttendance(
      [asg({ week_id: "w-draft", attendance_status: "absent", attendance_note: "Auto-absence", auto_absent: true })],
      weeks,
      locations,
      {},
    );
    expect(s.tally).toMatchObject({ absent: 1, total: 1 });
    expect(s.score).toBe(0);
    expect(s.records[0]).toMatchObject({
      status: "absent",
      note: "Auto-absence",
      auto_absent: true,
      week_start: "2020-03-08",
    });
  });

  it("uses the time-clock grade for an unmarked shift when one is given", () => {
    const a = asg();
    const s = summarizePersonAttendance([a], weeks, locations, { [a.id]: "late" });
    expect(s.records[0].status).toBe("late");
    expect(s.tally).toMatchObject({ late: 1, present: 0 });
  });

  it("labels the clinic by display name, then name, then short code, else null", () => {
    const s = summarizePersonAttendance(
      [
        asg({ location_id: "loc-full" }),
        asg({ location_id: "loc-name" }),
        asg({ location_id: "loc-code" }),
        asg({ location_id: "loc-blank" }),
        asg({ location_id: "loc-unknown" }),
      ],
      weeks,
      locations,
      {},
    );
    expect(s.records.map((r) => r.location_name)).toEqual([
      "Venice Clinic",
      "Sherman Oaks",
      "VAN",
      null,
      null,
    ]);
  });
});
