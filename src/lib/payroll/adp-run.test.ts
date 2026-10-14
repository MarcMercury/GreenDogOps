import { describe, expect, it } from "vitest";
import { adpExportBlockers, adpRunCsv, adpSettingsFrom, batchIdFor, reviewSummaryCsv, ADP_SETTING_KEYS } from "./adp-run";
import { zeroHours, type ReviewedLine } from "./review";

const SETTINGS = adpSettingsFrom(
  new Map<string, unknown>([
    [ADP_SETTING_KEYS.companyCode, "GD1"],
    [ADP_SETTING_KEYS.codes.double_time, "DT"],
    [ADP_SETTING_KEYS.codes.meal_premium, "MP"],
    [ADP_SETTING_KEYS.codes.rest_premium, "RP"],
    [ADP_SETTING_KEYS.codes.pto, "PTO"],
  ]),
);

const line = (id: string | null, name: string, over: Partial<ReviewedLine["hours"]> = {}): ReviewedLine => ({
  person_id: name,
  name,
  adp_employee_id: id,
  flsa: "non_exempt",
  hours: { ...zeroHours(), ...over },
});

describe("ADP RUN Time Sheet Import file", () => {
  it("uses the pay date as a 6-digit batch id", () => {
    expect(batchIdFor("2026-10-23")).toBe("261023");
  });

  it("writes Reg/O-T on the employee row and one coded row per other earning", () => {
    const csv = adpRunCsv(
      [
        line("1002", "Bo", { regular: 64, pto: 16 }),
        line("1001", "Al", { regular: 72.5, overtime: 3.25, double_time: 0.5, meal_premium: 1, rest_premium: 2 }),
      ],
      SETTINGS,
      "2026-10-23",
    );
    expect(csv.split("\r\n")).toEqual([
      "Co Code,Batch ID,File #,Reg Hours,O/T Hours,Hours 3 Code,Hours 3 Amount",
      "GD1,261023,1001,72.50,3.25,,",
      "GD1,261023,1001,,,DT,0.50",
      "GD1,261023,1001,,,MP,1.00",
      "GD1,261023,1001,,,RP,2.00",
      "GD1,261023,1002,64.00,,,",
      "GD1,261023,1002,,,PTO,16.00",
      "",
    ]);
  });

  it("an employee with only PTO gets only the PTO row", () => {
    const csv = adpRunCsv([line("7", "Cy", { pto: 8 })], SETTINGS, "2026-10-23");
    expect(csv).toBe("Co Code,Batch ID,File #,Reg Hours,O/T Hours,Hours 3 Code,Hours 3 Amount\r\nGD1,261023,7,,,PTO,8.00\r\n");
  });

  it("blocks the export without a company code, a needed earnings code, or an employee ID", () => {
    const empty = adpSettingsFrom(new Map());
    const b = adpExportBlockers([line("1", "A", { regular: 8, meal_premium: 1 }), line(null, "B", { regular: 8 })], empty);
    expect(b.join(" ")).toMatch(/company code/);
    expect(b.join(" ")).toMatch(/meal premium/);
    expect(b.join(" ")).toMatch(/1 employee\(s\) in the review have no ADP RUN Employee ID/);
    expect(b.join(" ")).not.toMatch(/double time/);
    expect(adpExportBlockers([line("1", "A", { regular: 8, meal_premium: 1 })], SETTINGS)).toEqual([]);
    expect(adpExportBlockers([], { ...SETTINGS, companyCode: "G D,1" })[0]).toMatch(/letters and digits/);
  });

  it("reads numeric setting values as text", () => {
    expect(adpSettingsFrom(new Map<string, unknown>([[ADP_SETTING_KEYS.companyCode, 123]])).companyCode).toBe("123");
  });

  it("builds a readable summary with names", () => {
    const csv = reviewSummaryCsv([line("1", "Smith, Al", { regular: 8 })], "2026-10-04", "2026-10-17");
    expect(csv).toContain('1,"Smith, Al",Non-exempt,8.00,0.00,0.00,0.00,0.00,0.00');
  });
});
