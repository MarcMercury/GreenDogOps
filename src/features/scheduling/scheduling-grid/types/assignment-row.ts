import type { SchedAssignment } from "@/lib/schedule/types";

/** The assignment columns the grid's write actions re-read before changing a row. */
export type AssignmentRow = Pick<
  SchedAssignment,
  | "id"
  | "week_id"
  | "line_id"
  | "location_id"
  | "day_of_week"
  | "person_id"
  | "work_date"
  | "attendance_status"
  | "removed_post_publish"
  | "added_post_publish"
>;
