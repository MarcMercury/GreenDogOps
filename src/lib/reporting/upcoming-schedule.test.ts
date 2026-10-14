import { describe, expect, it } from "vitest";
import { isUpcomingPostSlot, pacificWeekdayHour, staleAgendaWarning } from "./upcoming-schedule";

describe("isUpcomingPostSlot", () => {
  // During PDT (UTC-7) the 16:00 UTC cron is 9 AM Pacific; 17:00 UTC is 10 AM.
  it("posts on the 16:00 UTC run in daylight time", () => {
    expect(isUpcomingPostSlot(new Date("2026-10-12T16:00:00Z"))).toBe(true); // Mon
    expect(isUpcomingPostSlot(new Date("2026-10-14T16:00:00Z"))).toBe(true); // Wed
    expect(isUpcomingPostSlot(new Date("2026-10-16T16:00:00Z"))).toBe(true); // Fri
    expect(isUpcomingPostSlot(new Date("2026-10-16T17:00:00Z"))).toBe(false);
  });

  // During PST (UTC-8) the 17:00 UTC cron is 9 AM Pacific; 16:00 UTC is 8 AM.
  it("posts on the 17:00 UTC run in standard time", () => {
    expect(isUpcomingPostSlot(new Date("2026-11-02T17:00:00Z"))).toBe(true); // Mon
    expect(isUpcomingPostSlot(new Date("2026-11-02T16:00:00Z"))).toBe(false);
    expect(isUpcomingPostSlot(new Date("2026-11-06T17:00:00Z"))).toBe(true); // Fri
  });

  it("does not post on Tuesday, Thursday or the weekend", () => {
    expect(isUpcomingPostSlot(new Date("2026-10-13T16:00:00Z"))).toBe(false); // Tue
    expect(isUpcomingPostSlot(new Date("2026-10-15T16:00:00Z"))).toBe(false); // Thu
    expect(isUpcomingPostSlot(new Date("2026-10-17T16:00:00Z"))).toBe(false); // Sat
    expect(isUpcomingPostSlot(new Date("2026-10-18T16:00:00Z"))).toBe(false); // Sun
  });

  it("uses the Pacific weekday, not the UTC one", () => {
    // 2026-10-17 03:00 UTC is Fri 8 PM Pacific.
    expect(pacificWeekdayHour(new Date("2026-10-17T03:00:00Z"))).toEqual({ weekday: 5, hour: 20 });
  });
});

describe("staleAgendaWarning", () => {
  it("is silent when the pull is from today", () => {
    expect(staleAgendaWarning("2026-10-14", "2026-10-14")).toBeNull();
  });

  it("flags an older pull with its date", () => {
    expect(staleAgendaWarning("2026-10-13", "2026-10-14")).toContain("from Oct 13");
  });

  it("flags a missing pull", () => {
    expect(staleAgendaWarning(null, "2026-10-14")).toContain("No ezyVet Agenda pull");
  });
});
