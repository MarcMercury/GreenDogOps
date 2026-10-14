import type { AttendanceTotals } from "@/features/scheduling/attendance/types/attendance-totals";
import type { EmployeeAttendance } from "@/features/scheduling/attendance/types/employee-attendance";

/** Company-wide counts for the stat tiles; excused lates and absences fold into Late / Absent. */
export function attendanceTotals(employees: EmployeeAttendance[]): AttendanceTotals {
  const acc = {
    present: 0,
    late: 0,
    absent: 0,
    no_show: 0,
  };
  for (const e of employees) {
    acc.present += e.tally.present;
    acc.late += e.tally.late + e.tally.late_excused;
    acc.absent += e.tally.absent + e.tally.absent_excused;
    acc.no_show += e.tally.no_show;
  }
  return acc;
}
