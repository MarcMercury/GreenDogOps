import { describe, expect, it } from "vitest";
import { IGNORE_VALUE, apptTypeSelectValue } from "./appt-type-select";

describe("apptTypeSelectValue", () => {
  it("prefers the ignore marker, then the department, then unassigned", () => {
    expect(apptTypeSelectValue({ is_ignored: true, department_id: "d1" })).toBe(IGNORE_VALUE);
    expect(apptTypeSelectValue({ is_ignored: false, department_id: "d1" })).toBe("d1");
    expect(apptTypeSelectValue({ is_ignored: false, department_id: null })).toBe("");
  });
});
