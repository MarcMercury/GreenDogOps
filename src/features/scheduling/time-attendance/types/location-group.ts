import type { GradedRow } from "@/features/scheduling/time-attendance/types/graded-row";

/** One clinic's graded shifts for the day — the page renders a section per group. */
export interface LocationGroup {
  id: string;
  name: string;
  rows: GradedRow[];
}
