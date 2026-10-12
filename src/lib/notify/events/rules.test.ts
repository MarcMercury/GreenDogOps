import { describe, expect, it } from "vitest";
import { coverageCandidates, shiftsByPerson, timeOffKindLabel, weekIsPast } from "./schedule-rules";
import { isCanceled, isInactiveEvent, marketingChanges, newlyAssigned, type MarketingEventRow } from "./marketing-rules";

describe("shiftsByPerson", () => {
  it("lists each person's own shifts in order", () => {
    const m = shiftsByPerson([
      { person_id: "a", work_date: "2026-10-20", location_name: "Aetna", start_time: "09:00:00", end_time: "17:00:00", label: "DVM" },
      { person_id: "b", work_date: "2026-10-19", location_name: "Venice", start_time: "07:00:00", end_time: "15:30:00", label: null },
      { person_id: "a", work_date: "2026-10-19", location_name: "Venice", start_time: "07:00:00", end_time: "17:00:00", label: "DVM" },
    ]);
    expect(m.get("a")).toEqual(["Mon, Oct 19 · 7a–5p · Venice · DVM", "Tue, Oct 20 · 9a–5p · Aetna · DVM"]);
    expect(m.get("b")).toEqual(["Mon, Oct 19 · 7a–3:30p · Venice"]);
  });
});

describe("coverageCandidates", () => {
  it("offers role members who are free that day", () => {
    expect(
      coverageCandidates({
        roleMemberIds: ["out", "working", "off", "free", "former", "free"],
        activePersonIds: new Set(["out", "working", "off", "free"]),
        scheduledThatDay: new Set(["working"]),
        offThatDay: new Set(["off"]),
        absentPersonId: "out",
      }),
    ).toEqual(["free"]);
  });
});

describe("weekIsPast / timeOffKindLabel", () => {
  it("treats a week as past only after its Saturday", () => {
    expect(weekIsPast("2026-10-11", "2026-10-17")).toBe(false);
    expect(weekIsPast("2026-10-11", "2026-10-18")).toBe(true);
  });
  it("labels kinds", () => {
    expect(timeOffKindLabel("pto")).toBe("PTO");
    expect(timeOffKindLabel("sick_leave")).toBe("Sick leave");
  });
});

const ev = (p: Partial<MarketingEventRow>): MarketingEventRow => ({
  id: "e1",
  name: "Pet Fair",
  status: "planning",
  starts_on: "2026-11-07",
  ends_on: null,
  arrival_time: "8:15 AM",
  departure_time: null,
  location: "Venice",
  clinic_served: null,
  parking_info: null,
  staff_ids: ["a"],
  ...p,
});

describe("marketing change detection", () => {
  it("reports only the fields staff care about", () => {
    expect(marketingChanges(ev({}), ev({ arrival_time: "9:00 AM", location: " Venice " }))).toEqual(["arrival time"]);
    expect(marketingChanges(ev({ location: null }), ev({ location: "" }))).toEqual([]);
  });

  it("finds newly assigned staff", () => {
    expect(newlyAssigned(ev({ staff_ids: ["a"] }), ev({ staff_ids: ["a", "b", "b"] }))).toEqual(["b"]);
    expect(newlyAssigned(null, ev({ staff_ids: ["a"] }))).toEqual(["a"]);
    expect(newlyAssigned(ev({}), ev({ staff_ids: "junk" }))).toEqual([]);
  });

  it("recognises canceled and finished events", () => {
    expect(isCanceled("cancelled")).toBe(true);
    expect(isCanceled("Canceled")).toBe(true);
    expect(isCanceled("planning")).toBe(false);
    expect(isInactiveEvent(ev({ status: "completed" }), "2026-10-01")).toBe(true);
    expect(isInactiveEvent(ev({ starts_on: "2026-09-01" }), "2026-10-01")).toBe(true);
    expect(isInactiveEvent(ev({}), "2026-10-01")).toBe(false);
  });
});
