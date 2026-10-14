import type { LateLevel, ShiftState } from "@/lib/timeclock/attendance";

/** What the headline numbers read from a graded shift. */
interface GradeLike {
  state: ShiftState;
  lateLevel: LateLevel;
  session: object | null;
}

/** What the table order reads from a graded shift. */
interface SortableShift {
  shift: { start_time: string | null; person_name: string };
}

export interface LocationStats {
  /** Every published shift at the clinic that day. */
  scheduled: number;
  /** Shifts that have started — upcoming shifts and approved time off don't count. */
  started: number;
  /** Started shifts with a matching time-clock session. */
  matched: number;
  working: number;
  notInYet: number;
  /** Late or very late, whatever the shift's state now. */
  late: number;
  missed: number;
  /** Completed, or left early. */
  done: number;
  pto: number;
  /** Share of started shifts with a punch ("75%"), or "—" before anything has started. */
  punchMatchLabel: string;
}

/** The numbers above a clinic's table. */
export function locationStats(rows: readonly GradeLike[]): LocationStats {
  const started = rows.filter((r) => r.state !== "upcoming" && r.state !== "pto");
  const matched = started.filter((r) => r.session !== null).length;
  const count = (s: ShiftState) => rows.filter((r) => r.state === s).length;
  const late = rows.filter((r) => r.lateLevel !== null).length;
  return {
    scheduled: rows.length,
    started: started.length,
    matched,
    working: count("working"),
    notInYet: count("not_in_yet"),
    late,
    missed: count("missed"),
    done: count("completed") + count("left_early"),
    pto: count("pto"),
    punchMatchLabel: started.length ? `${Math.round((matched / started.length) * 100)}%` : "—",
  };
}

/** Table order: by shift start, untimed shifts last, then by name. */
export function sortShiftRows<R extends SortableShift>(rows: readonly R[]): R[] {
  return [...rows].sort(
    (a, b) =>
      (a.shift.start_time ?? "99").localeCompare(b.shift.start_time ?? "99") ||
      a.shift.person_name.localeCompare(b.shift.person_name),
  );
}
