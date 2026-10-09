import { describe, expect, it } from "vitest";
import {
  buildIcs,
  computeSlots,
  datesBetween,
  groupSlotsByDay,
  monthGrid,
  monthLabel,
  monthOf,
  parseWeeklyHours,
  shiftMonth,
  zonedParts,
  zonedTimeToUtc,
} from "./scheduling";

const LA = "America/Los_Angeles";

describe("zonedTimeToUtc", () => {
  it("handles daylight and standard time", () => {
    expect(zonedTimeToUtc("2026-10-13", "11:30", LA).toISOString()).toBe("2026-10-13T18:30:00.000Z");
    expect(zonedTimeToUtc("2026-12-01", "11:30", LA).toISOString()).toBe("2026-12-01T19:30:00.000Z");
  });

  it("round-trips through zonedParts across the DST change", () => {
    for (const [date, time] of [["2026-11-01", "09:00"], ["2026-03-08", "10:00"], ["2026-11-02", "16:45"]]) {
      expect(zonedParts(zonedTimeToUtc(date, time, LA), LA)).toEqual({ date, time });
    }
  });
});

describe("parseWeeklyHours", () => {
  it("keeps valid windows only, sorted", () => {
    expect(
      parseWeeklyHours([
        { day: 3, start: "10:00", end: "16:00" },
        { day: 1, start: "10:00", end: "12:00" },
        { day: 7, start: "10:00", end: "12:00" },
        { day: 2, start: "15:00", end: "09:00" },
        { day: 2, start: "9:00", end: "12:00" },
        "nope",
      ]),
    ).toEqual([
      { day: 1, start: "10:00", end: "12:00" },
      { day: 3, start: "10:00", end: "16:00" },
    ]);
  });
});

describe("computeSlots", () => {
  // Tuesday Oct 13 2026, 10:00–12:00 LA.
  const base = {
    windows: [{ day: 2, start: "10:00", end: "12:00" }],
    timeZone: LA,
    dateFrom: "2026-10-12",
    dateTo: "2026-10-14",
    durationMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date("2026-10-01T00:00:00Z"),
    busy: [],
  };
  const labels = (slots: Date[]) => slots.map((s) => zonedParts(s, LA).time);

  it("offers every step inside the window on matching weekdays", () => {
    expect(labels(computeSlots(base))).toEqual(["10:00", "10:30", "11:00", "11:30"]);
  });

  it("keeps busy blocks plus buffer clear", () => {
    const busy = [{ start: zonedTimeToUtc("2026-10-13", "10:30", LA), end: zonedTimeToUtc("2026-10-13", "11:00", LA) }];
    expect(labels(computeSlots({ ...base, busy }))).toEqual(["10:00", "11:00", "11:30"]);
    expect(labels(computeSlots({ ...base, busy, bufferMinutes: 15 }))).toEqual(["11:30"]);
  });

  it("respects minimum notice", () => {
    const now = zonedTimeToUtc("2026-10-13", "09:00", LA);
    expect(labels(computeSlots({ ...base, now, minNoticeMinutes: 120 }))).toEqual(["11:00", "11:30"]);
  });

  it("never runs past the end of the window", () => {
    expect(labels(computeSlots({ ...base, durationMinutes: 45 }))).toEqual(["10:00", "10:30", "11:00"]);
  });

  it("groups slots by day with candidate-friendly labels", () => {
    const days = groupSlotsByDay(computeSlots({ ...base, dateTo: "2026-10-20" }), LA);
    expect(days.map((d) => d.label)).toEqual(["Tuesday, October 13", "Tuesday, October 20"]);
    expect(days[0].times[0].label).toBe("10:00 AM");
  });
});

describe("datesBetween", () => {
  it("is inclusive", () => {
    expect(datesBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});

describe("month calendar", () => {
  it("builds Sunday-first weeks with blanks outside the month", () => {
    // October 2026 starts on a Thursday and has 31 days.
    const weeks = monthGrid("2026-10");
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(weeks[4]).toEqual(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("handles leap-year February", () => {
    expect(monthGrid("2028-02").flat().filter(Boolean)).toHaveLength(29);
  });

  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(monthOf("2026-10-13")).toBe("2026-10");
    expect(monthLabel("2026-10")).toBe("October 2026");
  });
});

describe("buildIcs", () => {
  it("writes a UTC event with escaped text and CRLF lines", () => {
    const ics = buildIcs({
      uid: "abc@greendog",
      start: new Date("2026-10-13T18:30:00Z"),
      end: new Date("2026-10-13T19:00:00Z"),
      summary: "Phone interview, Green Dog",
      description: "Line one\nLine; two",
      now: new Date("2026-10-08T00:00:00Z"),
    });
    expect(ics).toContain("DTSTART:20261013T183000Z\r\n");
    expect(ics).toContain("SUMMARY:Phone interview\\, Green Dog\r\n");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine\\; two\r\n");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});
