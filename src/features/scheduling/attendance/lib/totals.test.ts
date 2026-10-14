import { describe, expect, it } from "vitest";
import type { EmployeeAttendance } from "@/features/scheduling/attendance/types/employee-attendance";
import { emptyTally } from "./tally";
import { attendanceTotals } from "./totals";

const employee = (over: Partial<EmployeeAttendance["tally"]>): EmployeeAttendance => ({
  personId: "p",
  name: "P",
  tally: { ...emptyTally(), ...over },
  score: null,
});

describe("attendanceTotals", () => {
  it("is all zeros with no employees", () => {
    expect(attendanceTotals([])).toEqual({ present: 0, late: 0, absent: 0, no_show: 0 });
  });

  it("sums across employees and folds excused lates / absences into Late / Absent", () => {
    const totals = attendanceTotals([
      employee({ present: 3, late: 1, late_excused: 2, absent: 1, absent_excused: 1, no_show: 1 }),
      employee({ present: 2, late_excused: 1, pto: 4, scheduled: 9 }),
    ]);
    expect(totals).toEqual({ present: 5, late: 4, absent: 2, no_show: 1 });
  });
});
