import { describe, expect, it } from "vitest";
import { compareQueueRows, type QueueSortable } from "./interview-queue";

const iv = (date: string | null, start_time: string | null = null): QueueSortable => ({
  kind: "interview",
  date,
  start_time,
});
const link = (date: string): QueueSortable => ({ kind: "invite", date, start_time: null });

describe("compareQueueRows", () => {
  it("sorts interviews by date, then start time", () => {
    const rows = [iv("2026-10-14", "09:00"), iv("2026-10-12", "15:30"), iv("2026-10-12", "08:00"), iv("2026-10-01", "10:00")];
    expect(rows.sort(compareQueueRows)).toEqual([
      iv("2026-10-01", "10:00"),
      iv("2026-10-12", "08:00"),
      iv("2026-10-12", "15:30"),
      iv("2026-10-14", "09:00"),
    ]);
  });

  it("ignores status — past, upcoming and completed interleave by date", () => {
    // Previously rows were grouped by status first (needs results, scheduled, …).
    const past = { ...iv("2026-10-05", "10:00") };
    const future = { ...iv("2026-10-20", "10:00") };
    const today = { ...iv("2026-10-09", "13:00") };
    expect([future, past, today].sort(compareQueueRows)).toEqual([past, today, future]);
  });

  it("puts a missing time after timed interviews on the same day", () => {
    expect([iv("2026-10-12"), iv("2026-10-12", "16:00")].sort(compareQueueRows)).toEqual([
      iv("2026-10-12", "16:00"),
      iv("2026-10-12"),
    ]);
  });

  it("lists undated interviews, then unbooked links, after dated interviews", () => {
    const rows = [link("2026-10-10"), iv(null), iv("2026-12-01", "09:00"), link("2026-10-09")];
    expect(rows.sort(compareQueueRows)).toEqual([
      iv("2026-12-01", "09:00"),
      iv(null),
      link("2026-10-09"),
      link("2026-10-10"),
    ]);
  });
});
