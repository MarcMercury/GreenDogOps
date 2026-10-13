import { describe, expect, it } from "vitest";
import { publishUrgency, untimedShifts, weeksNeedingReminder, weekStartOf } from "./publish";

// 2026-10-13 is a Tuesday; this week starts Sun 2026-10-11.
describe("publish urgency", () => {
  it("finds the week's Sunday", () => {
    expect(weekStartOf("2026-10-13")).toBe("2026-10-11");
    expect(weekStartOf("2026-10-11")).toBe("2026-10-11");
    expect(weekStartOf("2026-10-17")).toBe("2026-10-11");
  });

  it("flags the current week as overdue until published", () => {
    expect(publishUrgency("2026-10-11", "draft", "2026-10-13")).toBe("overdue");
    expect(publishUrgency("2026-10-11", "approved", "2026-10-13")).toBe("overdue");
    expect(publishUrgency("2026-10-11", "published", "2026-10-13")).toBeNull();
  });

  it("makes next week due from Thursday", () => {
    expect(publishUrgency("2026-10-18", "draft", "2026-10-14")).toBeNull(); // Wed
    expect(publishUrgency("2026-10-18", "draft", "2026-10-15")).toBe("due"); // Thu
    expect(publishUrgency("2026-10-18", "pending_approval", "2026-10-17")).toBe("due"); // Sat
    expect(publishUrgency("2026-10-25", "draft", "2026-10-17")).toBeNull(); // two weeks out
  });

  it("does not nag about past weeks", () => {
    expect(publishUrgency("2026-09-27", "draft", "2026-10-13")).toBeNull();
  });

  it("lists the weeks to remind about", () => {
    expect(weeksNeedingReminder("2026-10-13")).toEqual(["2026-10-11"]);
    expect(weeksNeedingReminder("2026-10-15")).toEqual(["2026-10-11", "2026-10-18"]);
  });
});

describe("untimedShifts", () => {
  it("lists shifts missing a start or end time, in date order", () => {
    expect(
      untimedShifts([
        { work_date: "2026-10-20", person_name: "Bo", line_label: "Tech", start_time: "08:00:00", end_time: null },
        { work_date: "2026-10-19", person_name: "Al", line_label: null, start_time: null, end_time: null },
        { work_date: "2026-10-19", person_name: "Cy", line_label: "DVM", start_time: "08:00:00", end_time: "17:00:00" },
      ]),
    ).toEqual(["2026-10-19 · Al", "2026-10-20 · Bo · Tech"]);
  });
});
