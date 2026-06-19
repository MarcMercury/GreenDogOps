// Domain types and helpers for the Scheduling module.

import type { Location } from "@/lib/shared/locations";

export type ScheduleStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "published"
  | "archived";

export type AttendanceStatus =
  | "scheduled"
  | "present"
  | "late"
  | "late_excused"
  | "absent"
  | "absent_excused"
  | "no_show"
  | "pto";

export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  published: "Published",
  archived: "Archived",
};

export const SCHEDULE_STATUS_TONE: Record<ScheduleStatus, string> = {
  draft: "bg-slate-100 text-slate-600",
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-sky-100 text-sky-800",
  published: "bg-emerald-100 text-emerald-800",
  archived: "bg-slate-200 text-slate-500",
};

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  scheduled: "Scheduled",
  present: "Present",
  late: "Late",
  late_excused: "Late (Excused)",
  absent: "Absent",
  absent_excused: "Absent (Excused)",
  no_show: "No Show",
  pto: "PTO",
};

export const ATTENDANCE_TONE: Record<AttendanceStatus, string> = {
  scheduled: "bg-slate-100 text-slate-600",
  present: "bg-emerald-100 text-emerald-700",
  late: "bg-amber-100 text-amber-800",
  late_excused: "bg-amber-50 text-amber-600",
  absent: "bg-red-100 text-red-700",
  absent_excused: "bg-orange-50 text-orange-600",
  no_show: "bg-red-200 text-red-800",
  pto: "bg-violet-100 text-violet-700",
};

/** Statuses a scheduler can apply by clicking an employee on a published grid. */
export const MARKABLE_ATTENDANCE: AttendanceStatus[] = [
  "present",
  "late",
  "late_excused",
  "absent",
  "absent_excused",
  "no_show",
  "pto",
];

/**
 * Resolve the attendance status to display and count. On a published schedule a
 * shift left unmarked ("scheduled") is assumed Present once its day has arrived
 * — schedulers only need to mark the exceptions, not every present employee.
 * Future shifts, removed shifts, and non-published weeks keep "scheduled".
 */
export function effectiveAttendance(
  assignment: Pick<
    SchedAssignment,
    "attendance_status" | "work_date" | "removed_post_publish"
  >,
  published: boolean,
  today: string = toISODate(new Date()),
): AttendanceStatus {
  const status = assignment.attendance_status;
  if (status !== "scheduled") return status;
  if (!published || assignment.removed_post_publish) return status;
  if (assignment.work_date && assignment.work_date > today) return status;
  return "present";
}

/** Days of the week, Sunday-first to match the legacy schedule layout. */
export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// ---------------------------------------------------------------------------
// Row shapes (mirror the DB tables).
// ---------------------------------------------------------------------------

/** The scheduler reads the shared, canonical location row. */
export type ScheduleLocation = Location;

export interface SchedDepartment {
  id: string;
  name: string;
  code: string | null;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SchedRole {
  id: string;
  department_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SchedRoleMember {
  id: string;
  role_id: string;
  person_id: string;
  created_at: string;
}

export interface SchedEmployeeSetting {
  person_id: string;
  weekly_shift_target: number;
  is_schedulable: boolean;
  default_location_id: string | null;
  notes: string | null;
}

export interface SchedShiftTemplate {
  id: string;
  department_id: string;
  role_id: string | null;
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface SchedWeek {
  id: string;
  week_start: string;
  title: string | null;
  status: ScheduleStatus;
  notes: string | null;
  created_by: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchedWeekLine {
  id: string;
  week_id: string;
  template_id: string | null;
  department_id: string;
  role_id: string | null;
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  sort_order: number;
  is_adhoc: boolean;
}

export interface SchedWeekLocation {
  id: string;
  week_id: string;
  location_id: string;
  sort_order: number;
}

export interface SchedClosure {
  id: string;
  week_id: string;
  location_id: string;
  day_of_week: number;
  reason: string | null;
}

export interface SchedAssignment {
  id: string;
  week_id: string;
  line_id: string;
  location_id: string;
  person_id: string;
  day_of_week: number;
  work_date: string;
  attendance_status: AttendanceStatus;
  attendance_note: string | null;
  added_post_publish: boolean;
  removed_post_publish: boolean;
  auto_absent: boolean;
}

/** Minimal person shape used across scheduling UIs. */
export interface SchedPerson {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  grid_name: string | null;
  full_name: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Best short name for the grid. */
export function gridName(p: SchedPerson): string {
  const grid = p.grid_name?.trim();
  if (grid && grid !== "#N/A") return grid;
  const preferred = p.preferred_name?.trim();
  if (preferred) return `${preferred} ${p.last_name ?? ""}`.trim();
  const parts = [p.first_name, p.last_name].map((s) => s?.trim()).filter(Boolean);
  if (parts.length) return parts.join(" ");
  return p.full_name?.trim() || "—";
}

/** Format a "8:30 AM" style HH:MM:SS time into a compact label. */
export function formatTime(t: string | null): string {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  let h = Number(hStr);
  const m = Number(mStr);
  const ampm = h >= 12 ? "p" : "a";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, "0")}${ampm}`;
}

/** "8:30a–5p" range label for a shift line. */
export function timeRange(start: string | null, end: string | null): string {
  if (!start && !end) return "";
  return `${formatTime(start)}–${formatTime(end)}`;
}

/** Compute hours between two HH:MM times (best-effort, for the "(8)" badge). */
export function shiftHours(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return Math.round((mins / 60) * 10) / 10;
}

/** The Sunday on or before a given date (local). */
export function weekStartFor(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // getDay: 0=Sun
  return toISODate(d);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Date string for a given day index (0=Sun) within a week. */
export function dateForDay(weekStart: string, dayIndex: number): string {
  const d = new Date(`${weekStart}T00:00:00`);
  d.setDate(d.getDate() + dayIndex);
  return toISODate(d);
}

export function formatWeekRange(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(
    undefined,
    { ...opts, year: "numeric" },
  )}`;
}

// ---------------------------------------------------------------------------
// Reliability scoring (Attendance rollup)
// ---------------------------------------------------------------------------

export interface ReliabilityTally {
  total: number; // total resolved (excludes still-"scheduled")
  present: number;
  late: number;
  late_excused: number;
  absent: number;
  absent_excused: number;
  no_show: number;
  pto: number;
  scheduled: number; // not yet resolved
}

/** Weight each status toward a 0–100 reliability score. */
const RELIABILITY_WEIGHT: Record<AttendanceStatus, number> = {
  present: 1,
  pto: 1,
  late_excused: 0.9,
  absent_excused: 0.8,
  late: 0.6,
  absent: 0,
  no_show: 0,
  scheduled: 1, // upcoming shifts don't penalize
};

/** 0–100 reliability score from a tally; null when nothing resolved. */
export function reliabilityScore(t: ReliabilityTally): number | null {
  const counted: Array<[AttendanceStatus, number]> = [
    ["present", t.present],
    ["late", t.late],
    ["late_excused", t.late_excused],
    ["absent", t.absent],
    ["absent_excused", t.absent_excused],
    ["no_show", t.no_show],
    ["pto", t.pto],
  ];
  const denom = counted.reduce((n, [, c]) => n + c, 0);
  if (denom === 0) return null;
  const weighted = counted.reduce(
    (sum, [status, c]) => sum + RELIABILITY_WEIGHT[status] * c,
    0,
  );
  return Math.round((weighted / denom) * 100);
}

export function reliabilityTone(score: number | null): string {
  if (score == null) return "text-slate-400";
  if (score >= 90) return "text-emerald-600";
  if (score >= 75) return "text-amber-600";
  return "text-red-600";
}
