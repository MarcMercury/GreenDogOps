import { describe, expect, it } from "vitest";
import { IGNORE_VALUE, apptTypeDeptInput, apptTypeSelectValue } from "./appt-type-select";

describe("apptTypeSelectValue", () => {
  it("prefers the ignore marker, then the department, then unassigned", () => {
    expect(apptTypeSelectValue({ is_ignored: true, department_id: "d1" })).toBe(IGNORE_VALUE);
    expect(apptTypeSelectValue({ is_ignored: false, department_id: "d1" })).toBe("d1");
    expect(apptTypeSelectValue({ is_ignored: false, department_id: null })).toBe("");
  });
});

describe("apptTypeDeptInput", () => {
  it("turns the ignore marker into the flag with no department", () => {
    expect(apptTypeDeptInput("GDD (New)", IGNORE_VALUE)).toEqual({
      appt_type: "GDD (New)",
      department_id: "",
      is_ignored: true,
    });
  });

  it("passes a department through, and a blank choice as unassigned", () => {
    expect(apptTypeDeptInput("GDD (New)", "d1")).toEqual({ appt_type: "GDD (New)", department_id: "d1", is_ignored: false });
    expect(apptTypeDeptInput("GDD (New)", "")).toEqual({ appt_type: "GDD (New)", department_id: "", is_ignored: false });
  });

  it("round-trips with apptTypeSelectValue", () => {
    const ignored = apptTypeDeptInput("x", IGNORE_VALUE);
    expect(apptTypeSelectValue({ is_ignored: ignored.is_ignored, department_id: null })).toBe(IGNORE_VALUE);
    const dept = apptTypeDeptInput("x", "d1");
    expect(apptTypeSelectValue({ is_ignored: dept.is_ignored, department_id: dept.department_id })).toBe("d1");
  });
});
