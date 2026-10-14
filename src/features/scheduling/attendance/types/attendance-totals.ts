/** Company-wide counts for the stat tiles above the table. */
export interface AttendanceTotals {
  present: number;
  /** Late plus late (excused). */
  late: number;
  /** Absent plus absent (excused). */
  absent: number;
  no_show: number;
}
