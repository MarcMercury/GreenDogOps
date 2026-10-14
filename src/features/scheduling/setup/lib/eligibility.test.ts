import { describe, expect, it } from "vitest";
import type { SchedDepartment, SchedRole } from "@/lib/schedule/types";
import {
  buildDeptGroups,
  buildMatrixColumns,
  eligibilityKey,
  initialEligibility,
  isStudentFlagRole,
  nextStudentFlags,
  schedulablePersonIds,
} from "./eligibility";
import {
  STUDENT_COORDINATOR_ID,
  STUDENT_DEPT_ID,
  STUDENT_MENTOR_ID,
} from "./student-group";

const dept = (id: string, sort_order = 0): SchedDepartment => ({
  id,
  name: id,
  code: null,
  color: "#000000",
  sort_order,
  is_active: true,
  show_in_planning: false,
  created_at: "",
  updated_at: "",
});

const role = (id: string, department_id: string, sort_order = 0): SchedRole => ({
  id,
  department_id,
  name: id,
  sort_order,
  is_active: true,
  created_at: "",
  updated_at: "",
});

describe("initialEligibility", () => {
  it("keys real memberships and the student flags the same way", () => {
    const set = initialEligibility(
      [{ role_id: "r1", person_id: "p1" }],
      [
        { person_id: "p1", is_student_mentor: true, is_student_coordinator: false },
        { person_id: "p2", is_student_mentor: false, is_student_coordinator: true },
      ],
    );
    expect([...set].sort()).toEqual(
      [
        eligibilityKey("r1", "p1"),
        eligibilityKey(STUDENT_MENTOR_ID, "p1"),
        eligibilityKey(STUDENT_COORDINATOR_ID, "p2"),
      ].sort(),
    );
  });
});

describe("buildDeptGroups / buildMatrixColumns", () => {
  const groups = buildDeptGroups(
    [dept("d1"), dept("d2")],
    [role("r2", "d1", 2), role("r1", "d1", 1)],
  );

  it("keeps department order, sorts roles, keeps empty departments and appends Student last", () => {
    expect(groups.map((g) => g.dept.id)).toEqual(["d1", "d2", STUDENT_DEPT_ID]);
    expect(groups[0].roles.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(groups[1].roles).toEqual([]);
    expect(groups[2].roles.map((r) => r.id)).toEqual([
      STUDENT_MENTOR_ID,
      STUDENT_COORDINATOR_ID,
    ]);
  });

  it("flattens expanded roles, an 'empty' placeholder and collapsed strips", () => {
    const cols = buildMatrixColumns(groups, new Set([STUDENT_DEPT_ID]));
    expect(cols).toEqual([
      { kind: "role", role: groups[0].roles[0] },
      { kind: "role", role: groups[0].roles[1] },
      { kind: "empty", deptId: "d2" },
      { kind: "collapsed", deptId: STUDENT_DEPT_ID },
    ]);
  });
});

describe("schedulablePersonIds", () => {
  it("lists only people flagged Scheduling Active", () => {
    expect(
      schedulablePersonIds([
        { person_id: "p1", is_schedulable: true },
        { person_id: "p2", is_schedulable: false },
      ]),
    ).toEqual(new Set(["p1"]));
  });
});

describe("student flags", () => {
  it("recognises the two pseudo-roles only", () => {
    expect(isStudentFlagRole(STUDENT_MENTOR_ID)).toBe(true);
    expect(isStudentFlagRole(STUDENT_COORDINATOR_ID)).toBe(true);
    expect(isStudentFlagRole("r1")).toBe(false);
  });

  it("flips the toggled flag and keeps the other one from the current set", () => {
    const elig = new Set([eligibilityKey(STUDENT_COORDINATOR_ID, "p1")]);
    expect(nextStudentFlags(STUDENT_MENTOR_ID, "p1", false, elig)).toEqual({
      mentor: true,
      coordinator: true,
    });
    expect(nextStudentFlags(STUDENT_COORDINATOR_ID, "p1", true, elig)).toEqual({
      mentor: false,
      coordinator: false,
    });
  });
});
