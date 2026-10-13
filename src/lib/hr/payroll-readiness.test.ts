import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingForPayroll, normalizeAdpEmployeeId, readinessCounts, type ReadinessInput } from "./payroll-readiness";

const person = (over: Partial<ReadinessInput> = {}, emp: Partial<NonNullable<ReadinessInput["person_employment"]>> = {}): ReadinessInput => ({
  status: "employee",
  is_active: true,
  email: "a@example.com",
  person_employment: { flsa_status: "non_exempt", hire_date: "2024-01-01", adp_employee_id: "001234", ...emp },
  ...over,
});

describe("normalizeAdpEmployeeId", () => {
  it("trims and accepts letters, numbers and dashes", () => {
    expect(normalizeAdpEmployeeId(" 001234 ")).toEqual({ ok: true, value: "001234" });
    expect(normalizeAdpEmployeeId("GD-17")).toEqual({ ok: true, value: "GD-17" });
    expect(normalizeAdpEmployeeId("")).toEqual({ ok: true, value: null });
    expect(normalizeAdpEmployeeId(null)).toEqual({ ok: true, value: null });
  });
  it("rejects anything else", () => {
    for (const bad of ["12 34", "12/34", "x".repeat(21), "ñ1"]) expect(normalizeAdpEmployeeId(bad).ok, bad).toBe(false);
  });
  it("matches the database CHECK constraint", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0244_adp_employee_id.sql"), "utf8");
    expect(sql).toContain("adp_employee_id ~ '^[A-Za-z0-9-]{1,20}$'");
  });
});

describe("missingForPayroll", () => {
  it("is empty for a complete record", () => {
    expect(missingForPayroll(person())).toEqual([]);
  });
  it("lists every missing item in order", () => {
    expect(
      missingForPayroll(person({ email: " " }, { flsa_status: null, hire_date: null, adp_employee_id: null })),
    ).toEqual(["email", "flsa_status", "hire_date", "adp_employee_id"]);
    expect(missingForPayroll(person({ person_employment: null }))).toEqual(["flsa_status", "hire_date", "adp_employee_id"]);
  });
  it("ignores people who aren't on payroll", () => {
    expect(missingForPayroll(person({ status: "former" }, { adp_employee_id: null }))).toEqual([]);
    expect(missingForPayroll(person({ status: "applicant" }, { adp_employee_id: null }))).toEqual([]);
    expect(missingForPayroll(person({ is_active: false }, { adp_employee_id: null }))).toEqual([]);
    expect(missingForPayroll(person({ status: "contractor" }, { adp_employee_id: null }))).toEqual(["adp_employee_id"]);
  });
  it("counts across the roster", () => {
    const c = readinessCounts([person(), person({}, { adp_employee_id: null }), person({ status: "former" }, { adp_employee_id: null })]);
    expect(c).toMatchObject({ people: 2, ready: 1, adp_employee_id: 1, email: 0 });
  });
});
