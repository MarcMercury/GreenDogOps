import {
  DAY_LABELS,
  dateForDay,
  gridName,
  type SchedAssignment,
  type SchedPerson,
  type SchedRole,
  type SchedWeekLine,
  type ScheduleLocation,
} from "@/lib/schedule/types";
import { formatClock } from "@/features/scheduling/scheduling-grid/lib/time-format";

/** "YYYY-MM-DD" → "M/D/YYYY" for spreadsheet-friendly CSV output. */
export function csvDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** Quote/escape a single CSV cell per RFC 4180. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Build the When I Work-friendly CSV rows (header first). When I Work has no
 * shift-import file format, so the admin re-keys each shift by hand: they pick
 * a Location, then a Week, then work employee-by-employee. This export mirrors
 * that order — rows are grouped by Location (matching the location they select
 * in When I Work) and, within each location, by Employee — so the admin can
 * read straight down one location block, one employee at a time. Blank rows
 * separate each location (major break) and each employee (minor break) so the
 * transcription unit — one person's week at one site — is visually obvious.
 */
export function buildWiwCsvRows({
  assignments,
  lines,
  roles,
  locations,
  personById,
  weekStart,
}: {
  assignments: SchedAssignment[];
  lines: SchedWeekLine[];
  roles: SchedRole[];
  locations: ScheduleLocation[];
  personById: Map<string, SchedPerson>;
  weekStart: string;
}): string[][] {
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const roleById = new Map(roles.map((r) => [r.id, r]));
  // Location display order (same order the grid and When I Work list them in).
  const locSort = new Map(locations.map((l) => [l.id, l.sort_order]));
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  type Row = {
    locId: string;
    locName: string;
    locSort: number;
    personId: string;
    personName: string;
    day: number;
    date: string;
    start: string | null;
    end: string | null;
    position: string;
  };
  const flat: Row[] = [];
  for (const a of assignments) {
    if (a.removed_post_publish) continue;
    const person = personById.get(a.person_id);
    if (!person) continue;
    const line = lineById.get(a.line_id);
    const role = line?.role_id ? roleById.get(line.role_id) : null;
    flat.push({
      locId: a.location_id,
      locName: locName.get(a.location_id) ?? "—",
      locSort: locSort.get(a.location_id) ?? Number.MAX_SAFE_INTEGER,
      personId: a.person_id,
      personName: gridName(person),
      day: a.day_of_week,
      date: a.work_date || dateForDay(weekStart, a.day_of_week),
      start: line?.start_time ?? null,
      end: line?.end_time ?? null,
      position: line?.label || role?.name || "Shift",
    });
  }
  // Location order → employee name → date → start time.
  flat.sort(
    (x, y) =>
      x.locSort - y.locSort ||
      x.locName.localeCompare(y.locName) ||
      x.personName.localeCompare(y.personName) ||
      x.date.localeCompare(y.date) ||
      (x.start ?? "").localeCompare(y.start ?? ""),
  );

  const header = [
    "Location",
    "Employee",
    "Day",
    "Date",
    "Start Time",
    "End Time",
    "Position",
  ];
  const rows: string[][] = [header];
  let prevLocId: string | null = null;
  let prevPersonId: string | null = null;
  for (const r of flat) {
    if (prevLocId !== null && r.locId !== prevLocId) {
      // Major break between locations (two blank rows).
      rows.push([], []);
    } else if (prevPersonId !== null && r.personId !== prevPersonId) {
      // Minor break between employees within a location.
      rows.push([]);
    }
    rows.push([
      r.locName,
      r.personName,
      DAY_LABELS[r.day],
      csvDate(r.date),
      formatClock(r.start),
      formatClock(r.end),
      r.position,
    ]);
    prevLocId = r.locId;
    prevPersonId = r.personId;
  }
  return rows;
}

/** Serialise rows to CRLF-terminated CSV text. */
export function toCsvText(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
