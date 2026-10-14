import { describe, expect, it } from "vitest";
import type { SchedWeek } from "@/lib/schedule/types";
import {
  calendarMonthFor,
  neighborWeeks,
  sortWeeksAscending,
  weekIdByStart,
  weekStatusByStart,
} from "@/features/scheduling/scheduling-grid/lib/week-calendar";

const week = (id: string, week_start: string, status: SchedWeek["status"]): SchedWeek =>
  ({ id, week_start, status }) as SchedWeek;

const newestFirst = [
  week("c", "2026-10-18", "draft"),
  week("b", "2026-10-11", "pending_approval"),
  week("a", "2026-10-04", "published"),
];

describe("week calendar helpers", () => {
  it("sorts oldest first and finds the neighbours of the open week", () => {
    const ordered = sortWeeksAscending(newestFirst);
    expect(ordered.map((w) => w.id)).toEqual(["a", "b", "c"]);
    expect(neighborWeeks(ordered, "b")).toEqual({ prev: ordered[0], next: ordered[2] });
    expect(neighborWeeks(ordered, "a").prev).toBeNull();
    expect(neighborWeeks(ordered, "c").next).toBeNull();
    expect(neighborWeeks(ordered, null)).toEqual({ prev: null, next: null });
  });

  it("maps week starts to status and id", () => {
    expect(weekStatusByStart(newestFirst).get("2026-10-11")).toBe("pending_approval");
    expect(weekStatusByStart(newestFirst).has("2026-10-25")).toBe(false);
    expect(weekIdByStart(newestFirst).get("2026-10-04")).toBe("a");
  });

  it("opens the calendar on the month the week starts in, as a local date", () => {
    const m = calendarMonthFor("2026-10-04");
    expect([m.getFullYear(), m.getMonth(), m.getDate()]).toEqual([2026, 9, 1]);
  });
});
