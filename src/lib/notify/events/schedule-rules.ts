// Pure helpers behind the scheduling / time-off notification events.

import { shortDateLabel } from "../../worklist/dates";
import { timeRange } from "../../schedule/types";

export interface ShiftRow {
  person_id: string;
  work_date: string;
  location_name: string | null;
  start_time: string | null;
  end_time: string | null;
  label: string | null;
}

/** "Mon, Oct 19 · 7a–5p · Aetna · DVM". */
export function shiftLine(s: ShiftRow): string {
  return [shortDateLabel(s.work_date), timeRange(s.start_time, s.end_time), s.location_name, s.label]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" · ");
}

/** Each person's shifts, in date then start-time order. */
export function shiftsByPerson(rows: ShiftRow[]): Map<string, string[]> {
  const sorted = [...rows].sort(
    (a, b) =>
      a.work_date.localeCompare(b.work_date) ||
      (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
      (a.location_name ?? "").localeCompare(b.location_name ?? ""),
  );
  const out = new Map<string, string[]>();
  for (const s of sorted) {
    const list = out.get(s.person_id) ?? [];
    list.push(shiftLine(s));
    out.set(s.person_id, list);
  }
  return out;
}

const TIME_OFF_LABELS: Record<string, string> = {
  pto: "PTO",
  vacation: "Vacation",
  time_off: "Time off",
};

export function timeOffKindLabel(kind: string): string {
  return TIME_OFF_LABELS[kind] ?? kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** A week is entirely in the past when its Saturday is before today. */
export function weekIsPast(weekStart: string, today: string): boolean {
  const end = new Date(`${weekStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return end.toISOString().slice(0, 10) < today;
}

/**
 * People who could cover an open shift: members of the shift's scheduling
 * role who aren't already working that day, aren't on time off that day, and
 * aren't the person who is out.
 */
export function coverageCandidates(input: {
  roleMemberIds: string[];
  activePersonIds: Set<string>;
  scheduledThatDay: Set<string>;
  offThatDay: Set<string>;
  absentPersonId: string;
}): string[] {
  return [...new Set(input.roleMemberIds)]
    .filter(
      (id) =>
        id !== input.absentPersonId &&
        input.activePersonIds.has(id) &&
        !input.scheduledThatDay.has(id) &&
        !input.offThatDay.has(id),
    )
    .sort();
}

/** Attendance marks that leave a shift uncovered, and those that are a missed shift. */
export const UNCOVERED_ATTENDANCE = new Set(["absent", "no_show"]);
export const MISSED_SHIFT_ATTENDANCE = new Set(["no_show"]);
