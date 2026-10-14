import { describe, expect, it } from "vitest";
import { buildRules, rulesVersion } from "./rules";

const examples = () =>
  Object.fromEntries(buildRules().map((s) => [s.id, s.rules.map((r) => r.example ?? "").join(" | ")]));

describe("PTO & Timekeeping Rules page (generated from the engine)", () => {
  it("is deterministic, so a sign-off pins one exact version", () => {
    expect(rulesVersion(buildRules())).toBe(rulesVersion(buildRules()));
    expect(rulesVersion(buildRules())).toMatch(/^[0-9a-f]{12}$/);
  });

  it("computes the overtime examples with the payroll engine", () => {
    const e = examples().overtime;
    expect(e).toContain("A 10-hour day → 8 h regular, 2 h overtime (1.5x)");
    expect(e).toContain("A 13-hour day → 8 h regular, 4 h overtime (1.5x), 1 h double time (2x)");
    expect(e).toContain("Five 9-hour days → 40 h regular, 5 h overtime (1.5x)");
    expect(e).toContain("Six 8-hour days → 40 h regular, 8 h overtime (1.5x)");
    expect(e).toContain("40 h regular, 18 h overtime (1.5x), 2 h double time (2x) for the week");
    expect(e).toContain("An exempt 11-hour day → 11 h worked, 0 h overtime");
  });

  it("computes meal and PTO examples with the real rules", () => {
    const e = examples();
    expect(e.meals).toContain("5.5 h worked, no lunch → 1 meal premium hour (no meal period)");
    expect(e.meals).toContain("6-hour waiver signed → no premium");
    expect(e.pto).toContain("Out sick for part of a shift → 1 day (8 h) of PTO");
    expect(e.pto).not.toMatch(/0\.25|2 hours/);
    expect(e["pay-calendar"]).toContain("so it pays Thu 2026-12-31");
    expect(e["pto-annual"]).toContain("the payout is on 2027-01-15");
    expect(e["pto-annual"]).toContain("raised to 5 days");
    expect(e["pto-annual"]).toContain("payout 1.97 days");
  });

  it("marks the not-yet-automated yearly cycle as policy", () => {
    const status = Object.fromEntries(buildRules().map((s) => [s.id, s.status]));
    expect(status["pto-annual"]).toBe("policy");
    expect(status.overtime).toBe("live");
  });

  it("has no rest-break rule (10-minute breaks are not clocked or paid as premiums)", () => {
    const sections = buildRules();
    expect(sections.map((s) => s.id)).not.toContain("rest");
    expect(JSON.stringify(sections)).not.toMatch(/rest (break|premium)/i);
  });
});
