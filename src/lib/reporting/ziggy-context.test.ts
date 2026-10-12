import { describe, expect, it } from "vitest";
import { formatAskerContext, type AskerFacts } from "./ziggy-context";

const base: AskerFacts = {
  name: "Sam Rivera",
  email: "sam@example.com",
  role: "staff",
  today: "2026-10-12",
  employee: {
    status: "employee",
    jobTitle: "Veterinary Assistant",
    homeLocation: "Venice",
    hireDate: "2024-03-01",
    ptoAllotment: 80,
    ptoUsed: 24,
    ptoAvailable: 56,
    ptoHoursThisYear: 24,
    shifts: [
      { date: "2026-10-13", location: "Venice", label: "AM Tech", start: "07:30:00", end: "16:00:00", attendance: "scheduled" },
      { date: "2026-10-15", location: "Van Nuys", label: null, start: null, end: null, attendance: "absent" },
    ],
    timeOff: [{ kind: "pto", status: "approved", start: "2026-10-20", end: "2026-10-21" }],
  },
};

describe("formatAskerContext", () => {
  it("lists the asker's own shifts, time off and PTO balance", () => {
    const text = formatAskerContext(base);
    expect(text).toContain("Sam Rivera");
    expect(text).toContain("2026-10-13: Venice, AM Tech, 07:30–16:00");
    expect(text).toContain("2026-10-15: Van Nuys [absent]");
    expect(text).toContain("2026-10-20 to 2026-10-21: pto, approved");
    expect(text).toContain("available 56");
  });

  it("says plainly when there is nothing on file, so the model does not guess", () => {
    const empty = formatAskerContext({
      ...base,
      employee: { ...base.employee!, shifts: [], timeOff: [], ptoAllotment: null, ptoUsed: null, ptoAvailable: null },
    });
    expect(empty).toContain("Published shifts: none");
    expect(empty).toContain("Time-off requests: none");
    expect(empty).toContain("PTO balance: not recorded");

    const unlinked = formatAskerContext({ ...base, employee: null });
    expect(unlinked).toContain("not linked to an employee record");
    expect(unlinked).not.toContain("Published shifts");
  });

  it("never carries pay or benefit fields", () => {
    expect(formatAskerContext(base)).not.toMatch(/rate|wage|salary|benefit|\$/i);
  });
});
