import { describe, expect, it } from "vitest";
import {
  capacityCell,
  clinicSummary,
  isUpcomingPostSlot,
  missingSlotCountNote,
  pacificWeekdayHour,
  staleAgendaWarning,
} from "./upcoming-schedule";

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

describe("capacityCell", () => {
  it("shows booked over offered, and flags a full lane", () => {
    expect(capacityCell(12, 18, true)).toBe("12/18");
    expect(capacityCell(18, 18, true)).toBe("18/18 FULL");
    expect(capacityCell(19, 18, true)).toBe("19/18 FULL");
  });

  it("distinguishes an unconfigured lane from a closed one", () => {
    // Sherman Oaks Wednesday: 12 dental booked, no weekly slot count set.
    expect(capacityCell(12, 0, false)).toBe("12/?");
    // Configured closed, but something slipped onto the books.
    expect(capacityCell(12, 0, true)).toBe("12/—");
  });

  it("renders an empty lane as a dash either way", () => {
    expect(capacityCell(0, 0, true)).toBe("—");
    expect(capacityCell(0, 0, false)).toBe("—");
  });
});

describe("clinicSummary", () => {
  it("reports booked, open and fill over the configured lanes", () => {
    expect(clinicSummary("Venice", 124, 160)).toBe(
      "*Venice* — 124/160 booked · 36 open · 78% full",
    );
  });

  // The Sherman Oaks bug: Wednesday's bookings had no denominator, so the
  // clinic read as 49/41 — "120% full · 0 open" — while ezyVet had open slots.
  it("keeps bookings with no slot count out of the fill percentage", () => {
    expect(clinicSummary("Sherman Oaks", 36, 41, 13)).toBe(
      "*Sherman Oaks* — 36/41 booked · 5 open · 88% full · +13 booked in lanes with no slot count",
    );
  });

  it("never claims a fill percentage when nothing is configured", () => {
    expect(clinicSummary("Sherman Oaks", 49, 0, 49)).toBe(
      "*Sherman Oaks* — 49 booked · no slot counts set · +49 booked in lanes with no slot count",
    );
  });
});

describe("missingSlotCountNote", () => {
  it("is silent when every booked lane has a slot count", () => {
    expect(missingSlotCountNote([])).toBeNull();
  });

  it("names each gap and points at Daily Capacity", () => {
    const note = missingSlotCountNote(["Wed 10/21 Dental", "Wed 10/21 VE"]);
    expect(note).toContain("Wed 10/21 Dental, Wed 10/21 VE");
    expect(note).toContain("Daily Capacity");
  });
});
