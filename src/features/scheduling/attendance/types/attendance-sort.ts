import type { ReliabilityTally } from "@/lib/schedule/types";

/** Columns the Attendance & Reliability table can be sorted on. */
export type SortKey = "name" | "score" | "total" | keyof ReliabilityTally;
export type SortDir = "asc" | "desc";

/** The table's current filters and sort, as the user has set them. */
export interface AttendanceTableView {
  query: string;
  onlyResolved: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
}
