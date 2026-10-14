import type { SchedAssignment, SchedWeekLine } from "@/lib/schedule/types";
import { timeToMinutes } from "@/features/scheduling/scheduling-grid/lib/time-format";

/**
 * Decide whether two same-day assignments for the same person collide — i.e.
 * the person would have to be in two places at once. The same shift line is
 * always a collision (an exact duplicate). Otherwise the lines' time windows
 * are compared; when times are missing we only flag when the locations differ.
 */
export function assignmentsOverlap(
  a: SchedAssignment,
  b: SchedAssignment,
  lineById: Map<string, SchedWeekLine>,
): boolean {
  if (a.line_id === b.line_id) return true;
  const la = lineById.get(a.line_id);
  const lb = lineById.get(b.line_id);
  const s1 = timeToMinutes(la?.start_time);
  const e1 = timeToMinutes(la?.end_time);
  const s2 = timeToMinutes(lb?.start_time);
  const e2 = timeToMinutes(lb?.end_time);
  if (s1 === null || e1 === null || s2 === null || e2 === null) {
    // Times unknown: flag only cross-location double-bookings (can't be two
    // places at once); same-location split shifts are left alone.
    return a.location_id !== b.location_id;
  }
  // Half-open interval overlap test.
  return s1 < e2 && s2 < e1;
}
