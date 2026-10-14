import { ATTENDANCE_LABELS, type AttendanceStatus } from "@/lib/schedule/types";
import { requiredUuid, z } from "@/lib/validation/form";

/** Every attendance status, taken from the authoritative label map. */
const ATTENDANCE_STATUSES = Object.keys(ATTENDANCE_LABELS) as [
  AttendanceStatus,
  ...AttendanceStatus[],
];

/** markAttendance: a scheduler's manual mark on a published shift. */
export const markAttendanceSchema = z.object({
  assignmentId: requiredUuid("assignment id"),
  status: z.enum(ATTENDANCE_STATUSES),
  note: z.string().max(1000).nullable(),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;
