import { describe, expect, it } from "vitest";
import { formatClockTime, localHHMM, localToInstant } from "./local-time";

const TZ = "America/Los_Angeles";

describe("localToInstant", () => {
  it("converts Pacific daylight and standard time", () => {
    expect(localToInstant("2026-10-13", "08:02", TZ)?.toISOString()).toBe("2026-10-13T15:02:00.000Z");
    expect(localToInstant("2026-12-13", "08:02", TZ)?.toISOString()).toBe("2026-12-13T16:02:00.000Z");
  });

  it("handles the DST change days", () => {
    // 2026-11-01: 01:30 happens twice; the first (PDT) is used.
    expect(localToInstant("2026-11-01", "01:30", TZ)?.toISOString()).toBe("2026-11-01T08:30:00.000Z");
    expect(localToInstant("2026-11-01", "03:00", TZ)?.toISOString()).toBe("2026-11-01T11:00:00.000Z");
    // 2027-03-14: 02:30 does not exist; it lands in the hour after.
    expect(localToInstant("2027-03-14", "02:30", TZ)?.toISOString()).toBe("2027-03-14T10:30:00.000Z");
    expect(localToInstant("2027-03-14", "04:00", TZ)?.toISOString()).toBe("2027-03-14T11:00:00.000Z");
  });

  it("rejects malformed input", () => {
    for (const [d, t] of [
      ["2026-13-01", "08:00"],
      ["2026-02-30", "08:00"],
      ["2026-10-13", "24:00"],
      ["2026-10-13", "8am"],
      ["10/13/2026", "08:00"],
    ]) {
      expect(localToInstant(d, t, TZ), `${d} ${t}`).toBeNull();
    }
  });

  it("round-trips through the display helpers", () => {
    const iso = localToInstant("2026-10-13", "17:45", TZ)!.toISOString();
    expect(localHHMM(iso, TZ)).toBe("17:45");
    expect(formatClockTime(iso, TZ)).toBe("5:45 PM");
  });
});
