import type { ReliabilityTally } from "@/lib/schedule/types";

/** One row of the Attendance & Reliability table: an employee's rolled-up tally. */
export interface EmployeeAttendance {
  personId: string;
  name: string;
  tally: ReliabilityTally;
  score: number | null;
}
