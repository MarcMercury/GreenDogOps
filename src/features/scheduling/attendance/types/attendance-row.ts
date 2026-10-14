import type { SchedAssignment, SchedPerson } from "@/lib/schedule/types";

/**
 * The only assignment columns the attendance rollup reads — see
 * `ATTENDANCE_ASSIGNMENT_COLS` in `db/fetch-all-assignments-for-weeks.ts`.
 */
export type AttendanceAssignment = Pick<
  SchedAssignment,
  "id" | "week_id" | "person_id" | "work_date" | "attendance_status" | "removed_post_publish"
>;

/** One shift on a published week, joined to its person and week for the rollup. */
export interface AttendanceRow {
  assignment: AttendanceAssignment;
  person: SchedPerson | null;
  week_start: string;
  published: boolean;
}
