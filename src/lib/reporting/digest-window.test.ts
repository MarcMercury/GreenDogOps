import { describe, expect, it } from "vitest";
import type { LocationDailyRow } from "./types";
import {
  buildWindow,
  comparisonLine,
  datesIn,
  fmtNum,
  isScheduledOpen,
  lastCompleteBusinessWeek,
  metricSection,
} from "./digest-window";

const KEYS = ["venice", "van_nuys", "sherman_oaks"];

function row(
  location_key: string,
  service_date: string,
  appointments: number,
  revenue = appointments * 1000,
): LocationDailyRow {
  return {
    location_key: location_key as LocationDailyRow["location_key"],
    location_label: { venice: "Venice", van_nuys: "Van Nuys", sherman_oaks: "Sherman Oaks" }[
      location_key
    ]!,
    service_date,
    appointments,
    revenue,
    unique_clients: appointments,
  };
}

/** Mon–Sat of the week beginning 2026-09-28. */
const WEEK = { start: "2026-09-28", end: "2026-10-03" };

describe("lastCompleteBusinessWeek", () => {
  it("returns Mon–Sat and never includes a Sunday", () => {
    // Run on Monday Oct 5, the cron's normal cadence.
    expect(lastCompleteBusinessWeek("2026-10-05")).toEqual(WEEK);
    // Mid-week runs report the same completed week, not a partial one.
    expect(lastCompleteBusinessWeek("2026-10-07")).toEqual(WEEK);
    expect(lastCompleteBusinessWeek("2026-10-10")).toEqual(WEEK);
  });

  it("never reports a week that is still in progress", () => {
    // Saturday Oct 3 sits inside the Sep 28 week, which has not closed yet.
    expect(lastCompleteBusinessWeek("2026-10-03")).toEqual({
      start: "2026-09-21",
      end: "2026-09-26",
    });
  });

  it("does not count the in-progress week when run on a Sunday", () => {
    expect(lastCompleteBusinessWeek("2026-10-04")).toEqual({
      start: "2026-09-21",
      end: "2026-09-26",
    });
  });

  it("spans six days, Monday through Saturday", () => {
    const days = datesIn(lastCompleteBusinessWeek("2026-10-05")).map((d) =>
      new Date(`${d}T00:00:00Z`).getUTCDay(),
    );
    expect(days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(days).not.toContain(0);
  });
});

describe("isScheduledOpen", () => {
  it("closes every clinic on Sunday", () => {
    for (const key of KEYS) expect(isScheduledOpen(key, "2026-10-04")).toBe(false);
  });

  it("runs Venice and Van Nuys Mon–Sat", () => {
    for (const key of ["venice", "van_nuys"]) {
      expect(isScheduledOpen(key, "2026-09-28")).toBe(true); // Mon
      expect(isScheduledOpen(key, "2026-10-03")).toBe(true); // Sat
    }
  });

  it("runs Sherman Oaks only Mon, Wed and Fri", () => {
    expect(isScheduledOpen("sherman_oaks", "2026-09-28")).toBe(true); // Mon
    expect(isScheduledOpen("sherman_oaks", "2026-09-29")).toBe(false); // Tue
    expect(isScheduledOpen("sherman_oaks", "2026-09-30")).toBe(true); // Wed
    expect(isScheduledOpen("sherman_oaks", "2026-10-01")).toBe(false); // Thu
    expect(isScheduledOpen("sherman_oaks", "2026-10-02")).toBe(true); // Fri
    expect(isScheduledOpen("sherman_oaks", "2026-10-03")).toBe(false); // Sat
  });
});

describe("buildWindow", () => {
  /** A clean week: both six-day clinics trade Mon–Sat, Sherman Oaks M/W/F. */
  function fullWeek(): LocationDailyRow[] {
    const rows: LocationDailyRow[] = [];
    for (const date of datesIn(WEEK)) {
      rows.push(row("venice", date, 30), row("van_nuys", date, 20));
      if (isScheduledOpen("sherman_oaks", date)) rows.push(row("sherman_oaks", date, 15));
    }
    return rows;
  }

  it("counts each clinic's own open days, not calendar days", () => {
    const w = buildWindow(fullWeek(), WEEK, KEYS);
    expect(w.byLocation.get("venice")!.openDays).toBe(6);
    expect(w.byLocation.get("van_nuys")!.openDays).toBe(6);
    // The whole point: Sherman Oaks is divided by three, not six.
    expect(w.byLocation.get("sherman_oaks")!.openDays).toBe(3);
  });

  it("does not treat Sherman Oaks' closed days as missing data", () => {
    const w = buildWindow(fullWeek(), WEEK, KEYS);
    expect(w.byLocation.get("sherman_oaks")!.missing).toEqual([]);
    expect(w.blankDates).toEqual([]);
  });

  it("always reports a clinic that has no rows at all", () => {
    const rows = fullWeek().filter((r) => r.location_key !== "sherman_oaks");
    const w = buildWindow(rows, WEEK, KEYS);
    const so = w.byLocation.get("sherman_oaks")!;
    expect(so.label).toBe("Sherman Oaks");
    expect(so.appointments).toBe(0);
    expect(so.openDays).toBe(0);
    expect(so.missing).toEqual(["2026-09-28", "2026-09-30", "2026-10-02"]);
  });

  it("drops a blank scheduled day from the denominator instead of scoring it zero", () => {
    // The real Oct 2–3 ingest gap: no clinic billed on either day.
    const rows = fullWeek().filter(
      (r) => r.service_date !== "2026-10-02" && r.service_date !== "2026-10-03",
    );
    const w = buildWindow(rows, WEEK, KEYS);
    expect(w.blankDates).toEqual(["2026-10-02", "2026-10-03"]);
    expect(w.byLocation.get("venice")!.openDays).toBe(4);
    expect(w.byLocation.get("sherman_oaks")!.openDays).toBe(2);
    // Group trading days shrink too, so the Total line stays comparable.
    expect(w.openDays).toBe(4);
  });

  it("keeps off-schedule revenue in the total but out of the open-day count", () => {
    // A stray Sunday pickup at Sherman Oaks must not become a trading day.
    const rows = [...fullWeek(), row("sherman_oaks", "2026-10-04", 1)];
    const w = buildWindow(rows, { start: "2026-09-28", end: "2026-10-04" }, KEYS);
    const so = w.byLocation.get("sherman_oaks")!;
    expect(so.appointments).toBe(46); // 45 scheduled + the stray one
    expect(so.openDays).toBe(3); // unchanged
    expect(w.blankDates).toEqual([]); // Sunday is nobody's scheduled day
  });

  it("does not flag a Sunday as a missing day", () => {
    const w = buildWindow(fullWeek(), { start: "2026-09-28", end: "2026-10-04" }, KEYS);
    for (const key of KEYS) {
      expect(w.byLocation.get(key)!.missing).not.toContain("2026-10-04");
    }
    expect(w.blankDates).toEqual([]);
  });
});

describe("comparisonLine", () => {
  it("compares totals directly when both weeks had the same open days", () => {
    expect(
      comparisonLine("Venice", { value: 208, days: 6 }, { value: 199, days: 6 }, fmtNum),
    ).toBe("• Venice — 208  ▲ 4.5% _(was 199)_");
  });

  it("switches to a per-day average when the open-day counts differ", () => {
    // 120 over 4 days (30/day) vs 180 over 6 (30/day) is flat, not a 33% drop.
    expect(
      comparisonLine("Venice", { value: 120, days: 4 }, { value: 180, days: 6 }, fmtNum),
    ).toBe("• Venice — 120 over 4 open days  flat per day _(was 180 over 6)_");
  });

  it("does not say 'per day' where there is no rate to qualify", () => {
    expect(
      comparisonLine("Sherman Oaks", { value: 12, days: 3 }, { value: 0, days: 2 }, fmtNum),
    ).toBe("• Sherman Oaks — 12 over 3 open days  new _(was 0 over 2)_");
    expect(
      comparisonLine("Sherman Oaks", { value: 0, days: 3 }, { value: 0, days: 2 }, fmtNum),
    ).toBe("• Sherman Oaks — 0 over 3 open days  — _(was 0 over 2)_");
  });

  it("uses the singular when a clinic traded a single day", () => {
    expect(
      comparisonLine("Sherman Oaks", { value: 10, days: 1 }, { value: 30, days: 3 }, fmtNum),
    ).toBe("• Sherman Oaks — 10 over 1 open day  flat per day _(was 30 over 3)_");
  });

  it("bolds the total row", () => {
    expect(
      comparisonLine("Total", { value: 10, days: 3 }, { value: 5, days: 3 }, fmtNum, true),
    ).toBe("• *Total* — 10  ▲ 100.0% _(was 5)_");
  });
});

describe("metricSection", () => {
  const priorWeek = { start: "2026-09-21", end: "2026-09-26" };

  function window(range: { start: string; end: string }, perDayCounts: Record<string, number>) {
    const rows: LocationDailyRow[] = [];
    for (const date of datesIn(range)) {
      for (const key of KEYS) {
        if (isScheduledOpen(key, date)) rows.push(row(key, date, perDayCounts[key]));
      }
    }
    return buildWindow(rows, range, KEYS);
  }

  it("lists all three clinics and a total", () => {
    const cur = window(WEEK, { venice: 30, van_nuys: 20, sherman_oaks: 15 });
    const pri = window(priorWeek, { venice: 30, van_nuys: 20, sherman_oaks: 15 });
    const lines = metricSection(
      "Appointments by location",
      cur,
      pri,
      KEYS,
      (t) => t.appointments,
      fmtNum,
    );
    expect(lines[1]).toBe("*Appointments by location* · Sep 28 – Oct 3 vs Sep 21–26");
    expect(lines.slice(2)).toEqual([
      "• Venice — 180  flat _(was 180)_",
      "• Van Nuys — 120  flat _(was 120)_",
      "• Sherman Oaks — 45  flat _(was 45)_",
      "• *Total* — 345  flat _(was 345)_",
    ]);
  });

  it("totals only the clinics it printed", () => {
    const cur = window(WEEK, { venice: 30, van_nuys: 20, sherman_oaks: 15 });
    const pri = window(priorWeek, { venice: 30, van_nuys: 20, sherman_oaks: 15 });
    const lines = metricSection(
      "Appointments by location",
      cur,
      pri,
      ["venice", "van_nuys"],
      (t) => t.appointments,
      fmtNum,
    );
    expect(lines.at(-1)).toBe("• *Total* — 300  flat _(was 300)_");
  });
});
