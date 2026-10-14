import {
  dateForDay,
  gridName,
  type SchedAssignment,
  type SchedPerson,
  type SchedRole,
  type SchedWeekLine,
  type ScheduleLocation,
} from "@/lib/schedule/types";
import type { EmployeeSchedule } from "@/features/scheduling/scheduling-grid/types/grid";

/**
 * Per-employee shift list for the "Export per employee" printout: every
 * active assignment grouped by person, then sorted by date and start time so
 * each printed page reads top-to-bottom through the week.
 */
export function buildPerEmployeeShifts({
  assignments,
  lines,
  locations,
  roles,
  personById,
  weekStart,
}: {
  assignments: SchedAssignment[];
  lines: SchedWeekLine[];
  locations: ScheduleLocation[];
  roles: SchedRole[];
  personById: Map<string, SchedPerson>;
  weekStart: string;
}): EmployeeSchedule[] {
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const byPerson = new Map<string, EmployeeSchedule>();
  for (const a of assignments) {
    if (a.removed_post_publish) continue;
    const person = personById.get(a.person_id);
    if (!person) continue;
    const line = lineById.get(a.line_id);
    const loc = locationById.get(a.location_id);
    const role = line?.role_id ? roleById.get(line.role_id) : null;
    const entry = byPerson.get(a.person_id) ?? { person, shifts: [] };
    entry.shifts.push({
      day: a.day_of_week,
      date: a.work_date || dateForDay(weekStart, a.day_of_week),
      start: line?.start_time ?? null,
      end: line?.end_time ?? null,
      location: loc ? loc.name : "—",
      position: line?.label || role?.name || "Shift",
    });
    byPerson.set(a.person_id, entry);
  }
  const list = [...byPerson.values()];
  for (const e of list) {
    e.shifts.sort((x, y) =>
      x.date === y.date
        ? (x.start ?? "").localeCompare(y.start ?? "")
        : x.date.localeCompare(y.date),
    );
  }
  list.sort((a, b) => gridName(a.person).localeCompare(gridName(b.person)));
  return list;
}
