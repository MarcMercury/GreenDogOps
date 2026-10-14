import { describe, expect, it } from "vitest";
import { countDayStaffing } from "@/features/scheduling/scheduling-grid/lib/day-staffing";

const roles = [
  { id: "dvm", name: "DVM" },
  { id: "tech", name: "Clinic Tech" },
  { id: "csr", name: "CSR" },
];
const lines = [
  { id: "l-dvm", role_id: "dvm", department_id: "surgery" },
  { id: "l-dvm2", role_id: "dvm", department_id: "surgery" },
  { id: "l-tech", role_id: "tech", department_id: "surgery" },
  { id: "l-csr", role_id: "csr", department_id: "surgery" },
  { id: "l-other", role_id: "dvm", department_id: "dental" },
  { id: "l-any", role_id: null, department_id: "surgery" },
];

describe("countDayStaffing", () => {
  it("counts distinct people per category within the department", () => {
    const { staffing, dvmCount } = countDayStaffing(
      roles,
      lines,
      [
        { person_id: "a", line_id: "l-dvm", removed_post_publish: false },
        { person_id: "a", line_id: "l-dvm2", removed_post_publish: false }, // same doctor twice
        { person_id: "b", line_id: "l-dvm", removed_post_publish: false },
        { person_id: "c", line_id: "l-tech", removed_post_publish: false },
        { person_id: "d", line_id: "l-csr", removed_post_publish: false }, // excluded role
        { person_id: "e", line_id: "l-other", removed_post_publish: false }, // other department
        { person_id: "f", line_id: "l-any", removed_post_publish: false }, // no role
        { person_id: "g", line_id: "l-dvm", removed_post_publish: true }, // removed
      ],
      "surgery",
    );
    expect(staffing).toEqual({ dvm: 2, tech: 1, lead: 0, dental: 0, da: 0, float: 0 });
    expect(dvmCount).toBe(2);
  });

  it("never reports fewer than one DVM for the guide key", () => {
    const { staffing, dvmCount } = countDayStaffing(roles, lines, [], "surgery");
    expect(staffing.dvm).toBe(0);
    expect(dvmCount).toBe(1);
  });
});
