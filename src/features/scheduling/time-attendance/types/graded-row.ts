import type { GradedShift } from "@/lib/timeclock/attendance";
import type { AttendanceShift } from "@/lib/timeclock/attendance-server";
import type { EffectivePunch } from "@/lib/timeclock/timecard";

/** One published shift graded from the time clock, as `gradeRange()` returns it. */
export type GradedRow = GradedShift<AttendanceShift, EffectivePunch>;
