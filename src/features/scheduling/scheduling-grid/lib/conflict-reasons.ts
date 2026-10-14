import {
  timeRange,
  type SchedAssignment,
  type SchedWeekLine,
  type ScheduleLocation,
} from "@/lib/schedule/types";
import { assignmentsOverlap } from "@/features/scheduling/scheduling-grid/lib/assignments-overlap";

/**
 * Double-booking detection: a person cannot be in two overlapping shifts on
 * the same day. We flag (not block) the offending assignments so the grid can
 * highlight them in red with a reason in the tooltip.
 *
 * Returns, per assignment id, the list of "where + when" labels of the other
 * shifts it collides with.
 */
export function buildConflictReasons(
  activeAssignments: SchedAssignment[],
  lines: SchedWeekLine[],
  locations: ScheduleLocation[],
): Map<string, string[]> {
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const locLabel = (id: string) => {
    const l = locations.find((x) => x.id === id);
    return l ? l.short_code ?? l.name : "another location";
  };
  const reasons = new Map<string, string[]>();
  const byPersonDay = new Map<string, SchedAssignment[]>();
  for (const a of activeAssignments) {
    const key = `${a.person_id}|${a.day_of_week}`;
    if (!byPersonDay.has(key)) byPersonDay.set(key, []);
    byPersonDay.get(key)!.push(a);
  }
  const note = (a: SchedAssignment, other: SchedAssignment) => {
    const line = lineById.get(other.line_id);
    const time = timeRange(line?.start_time ?? null, line?.end_time ?? null);
    const where = locLabel(other.location_id);
    const label = [where, time].filter(Boolean).join(" ");
    const list = reasons.get(a.id) ?? [];
    list.push(label);
    reasons.set(a.id, list);
  };
  for (const list of byPersonDay.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (assignmentsOverlap(list[i], list[j], lineById)) {
          note(list[i], list[j]);
          note(list[j], list[i]);
        }
      }
    }
  }
  return reasons;
}
