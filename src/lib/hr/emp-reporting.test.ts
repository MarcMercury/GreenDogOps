import { describe, expect, it } from "vitest";
import {
  annualizeSalary,
  buildEmpReport,
  currentTitle,
  storedAnnualIsStale,
  type EmpInput,
} from "./emp-reporting";

function emp(over: Partial<EmpInput> = {}): EmpInput {
  return {
    name: "Test Person",
    title: "Veterinary Assistant",
    payType: "hourly",
    annualWages: null,
    currentRate: null,
    biweeklyWage: null,
    ...over,
  };
}

describe("annualizeSalary uses current pay", () => {
  it("uses the raised salary, not the stale stored annual wages", () => {
    // HR changed current_rate 75,200 -> 78,960; annual_wages was never recalculated.
    const e = emp({ payType: "salary", currentRate: 78960, annualWages: 75200 });
    expect(annualizeSalary(e)).toBe(78960);
    expect(storedAnnualIsStale(e)).toBe(true);
  });

  it("annualizes an hourly raise at full time", () => {
    const e = emp({ payType: "hourly", currentRate: 22.5, annualWages: 41600 });
    expect(annualizeSalary(e)).toBe(22.5 * 2080);
    expect(storedAnnualIsStale(e)).toBe(true);
  });

  it("treats an annual figure on an hourly row as a salary", () => {
    expect(annualizeSalary(emp({ payType: "hourly", currentRate: 70500 }))).toBe(70500);
  });

  it("annualizes a rate with no pay type by its size", () => {
    expect(annualizeSalary(emp({ payType: null, currentRate: 25 }))).toBe(52000);
    expect(annualizeSalary(emp({ payType: null, currentRate: 60000 }))).toBe(60000);
  });

  it("falls back to stored annual wages, then biweekly, when there is no rate", () => {
    expect(annualizeSalary(emp({ annualWages: 50000, biweeklyWage: 1000 }))).toBe(50000);
    expect(annualizeSalary(emp({ biweeklyWage: 2000 }))).toBe(52000);
    expect(annualizeSalary(emp())).toBeNull();
  });

  it("does not annualize day or contract rates", () => {
    expect(annualizeSalary(emp({ payType: "day_rate", currentRate: 1200 }))).toBeNull();
    expect(
      annualizeSalary(emp({ payType: "contract", currentRate: 90, annualWages: 80000 })),
    ).toBe(80000);
  });

  it("does not flag stored wages that match the current rate", () => {
    expect(
      storedAnnualIsStale(emp({ payType: "hourly", currentRate: 25, annualWages: 52000 })),
    ).toBe(false);
    expect(storedAnnualIsStale(emp({ payType: "hourly", currentRate: 25 }))).toBe(false);
  });
});

describe("currentTitle", () => {
  it("prefers the ADP job title over the title at hire", () => {
    expect(
      currentTitle({ adpJobTitle: "Lead CSR", positionTitle: "CSR", offerTitle: "CSR" }),
    ).toBe("Lead CSR");
  });

  it("falls back to position, then offer title, skipping blanks", () => {
    expect(currentTitle({ adpJobTitle: "  ", positionTitle: "RVT", offerTitle: "DA" })).toBe("RVT");
    expect(currentTitle({ adpJobTitle: null, offerTitle: " DA " })).toBe("DA");
    expect(currentTitle({})).toBeNull();
  });
});

describe("buildEmpReport", () => {
  it("averages current pay and counts stale stored wages", () => {
    const report = buildEmpReport([
      emp({ name: "A", title: "CSR", payType: "salary", currentRate: 60000, annualWages: 50000 }),
      emp({ name: "B", title: "CSR", payType: "salary", currentRate: 40000, annualWages: 40000 }),
      emp({ name: "C", title: "DVM", payType: "salary", currentRate: 150000 }),
      emp({ name: "D", title: "Chief Executive Officer", payType: "salary", currentRate: 1 }),
    ]);
    expect(report.company.avg).toBe(50000);
    expect(report.company.headcount).toBe(2);
    expect(report.staleStoredAnnual).toBe(1);
    expect(report.excludedExecutives).toBe(1);
    expect(report.roles.find((r) => r.kind === "doctor")?.avg).toBe(150000);
  });
});
