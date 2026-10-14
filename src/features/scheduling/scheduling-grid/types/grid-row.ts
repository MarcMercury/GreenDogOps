import type { SchedWeekLine } from "@/lib/schedule/types";

/**
 * One data row of the grid table. Rows are grouped by `departmentId`, so a
 * department with no shift lines yet still needs a row to get a section — the
 * Week Template shows every active department before it has lines, and a week
 * shows a department that has booked appointments but no staffing.
 */
export type GridRow =
  | { kind: "line"; id: string; departmentId: string; line: SchedWeekLine }
  | { kind: "empty"; id: string; departmentId: string };
