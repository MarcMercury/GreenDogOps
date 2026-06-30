import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { LOCATION_COLUMNS } from "@/lib/shared/locations";
import {
  effectiveAttendance,
  reliabilityScore,
  dateForDay,
  type AttendanceStatus,
  type ReliabilityTally,
} from "@/lib/schedule/types";
import type { PersonTimeOff } from "@/lib/hr/types";
import type {
  ScheduleLocation,
  SchedAssignment,
  SchedClosure,
  SchedEvent,
  SchedDepartment,
  SchedEmployeeSetting,
  SchedPerson,
  SchedRole,
  SchedRoleMember,
  SchedShiftTemplate,
  SchedWeek,
  SchedWeekLine,
  SchedWeekLocation,
} from "@/lib/schedule/types";
import type { GuideWithCapacity } from "@/lib/planning/resolve";
import type { PlanningGuide } from "@/lib/planning/types";

const PERSON_COLS =
  "id, first_name, last_name, preferred_name, grid_name, full_name";

type LocLookupRow = {
  id: string;
  name: string | null;
  display_name: string | null;
  short_code: string | null;
};

/**
 * Request-cached reference lookups. Several HR-profile helpers each re-read
 * these small, stable tables per request; `cache()` collapses the duplicates
 * into a single fetch per request without changing the returned data.
 */
const getLocationLookupRows = cache(async (): Promise<LocLookupRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("location")
    .select("id, name, display_name, short_code");
  return (data ?? []) as LocLookupRow[];
});

const getWeekLookupRows = cache(
  async (): Promise<{ id: string; week_start: string; status: string }[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("sched_week")
      .select("id, week_start, status");
    return (data ?? []) as { id: string; week_start: string; status: string }[];
  },
);

const getRoleLookupRows = cache(
  async (): Promise<{ id: string; name: string }[]> => {
    const supabase = await createClient();
    const { data } = await supabase.from("sched_role").select("id, name");
    return (data ?? []) as { id: string; name: string }[];
  },
);

/** Active practice locations, ordered for the grid. */
export const getLocations = cache(async (): Promise<ScheduleLocation[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("location")
    .select(LOCATION_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as unknown as ScheduleLocation[];
});

/**
 * Time-off requests that overlap a given Sunday-start week. Drives the
 * scheduler's color coding (requested = amber, approved = green).
 */
export async function getWeekTimeOff(
  weekStart: string,
): Promise<PersonTimeOff[]> {
  const supabase = await createClient();
  const weekEnd = dateForDay(weekStart, 6);
  const { data } = await supabase
    .from("person_time_off")
    .select("*")
    .in("status", ["requested", "approved"])
    .lte("start_date", weekEnd)
    .gte("end_date", weekStart);
  return (data ?? []) as PersonTimeOff[];
}

export interface SetupData {
  departments: SchedDepartment[];
  roles: SchedRole[];
  templates: SchedShiftTemplate[];
  members: SchedRoleMember[];
  settings: SchedEmployeeSetting[];
  people: SchedPerson[];
  locations: ScheduleLocation[];
}

/** Everything the Setup screens need in one shot. */
export async function getSetupData(): Promise<SetupData> {
  const supabase = await createClient();
  const [deptRes, roleRes, tplRes, memRes, setRes, peopleRes, locations] =
    await Promise.all([
      supabase
        .from("sched_department")
        .select("*")
        .order("sort_order")
        .order("name"),
      supabase.from("sched_role").select("*").order("sort_order").order("name"),
      supabase.from("sched_shift_template").select("*").order("sort_order"),
      supabase.from("sched_role_member").select("*"),
      supabase.from("sched_employee_setting").select("*"),
      supabase
        .from("person")
        .select(PERSON_COLS)
        .in("status", ["employee", "contractor"])
        .order("last_name"),
      getLocations(),
    ]);

  return {
    departments: (deptRes.data ?? []) as SchedDepartment[],
    roles: (roleRes.data ?? []) as SchedRole[],
    templates: (tplRes.data ?? []) as SchedShiftTemplate[],
    members: (memRes.data ?? []) as SchedRoleMember[],
    settings: (setRes.data ?? []) as SchedEmployeeSetting[],
    people: (peopleRes.data ?? []) as SchedPerson[],
    locations,
  };
}

/** Weeks list (most recent first). */
export async function getWeeks(): Promise<SchedWeek[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sched_week")
    .select("*")
    .order("week_start", { ascending: false });
  return (data ?? []) as SchedWeek[];
}

export async function getWeek(weekId: string): Promise<SchedWeek | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sched_week")
    .select("*")
    .eq("id", weekId)
    .maybeSingle();
  return (data as SchedWeek | null) ?? null;
}

export interface WeekData {
  week: SchedWeek;
  lines: SchedWeekLine[];
  weekLocations: SchedWeekLocation[];
  closures: SchedClosure[];
  events: SchedEvent[];
  assignments: SchedAssignment[];
}

/** Full grid payload for a single week. */
export async function getWeekData(weekId: string): Promise<WeekData | null> {
  const supabase = await createClient();
  const week = await getWeek(weekId);
  if (!week) return null;

  const [lineRes, locRes, closeRes, eventRes, asgRes] = await Promise.all([
    supabase
      .from("sched_week_line")
      .select("*")
      .eq("week_id", weekId)
      .order("sort_order"),
    supabase
      .from("sched_week_location")
      .select("*")
      .eq("week_id", weekId)
      .order("sort_order"),
    supabase.from("sched_closure").select("*").eq("week_id", weekId),
    supabase.from("sched_event").select("*").eq("week_id", weekId),
    supabase.from("sched_assignment").select("*").eq("week_id", weekId),
  ]);

  return {
    week,
    lines: (lineRes.data ?? []) as SchedWeekLine[],
    weekLocations: (locRes.data ?? []) as SchedWeekLocation[],
    closures: (closeRes.data ?? []) as SchedClosure[],
    events: (eventRes.data ?? []) as SchedEvent[],
    assignments: (asgRes.data ?? []) as SchedAssignment[],
  };
}

export interface AttendanceRow {
  assignment: SchedAssignment;
  person: SchedPerson | null;
  week_start: string;
  published: boolean;
}

/**
 * Fetch every row matching a `week_id IN (...)` filter, paging past PostgREST's
 * `max_rows` cap (1000). Without this the attendance rollup silently loses the
 * oldest published shifts once the schedule grows beyond a single page.
 */
async function fetchAllAssignmentsForWeeks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  weekIds: string[],
): Promise<SchedAssignment[]> {
  if (weekIds.length === 0) return [];
  const PAGE = 1000;
  const all: SchedAssignment[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("sched_assignment")
      .select("*")
      .in("week_id", weekIds)
      .order("work_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...(data as SchedAssignment[]));
    if (data.length < PAGE) break;
  }
  return all;
}

/** Resolved-attendance assignments across published weeks, for the rollup. */
export async function getAttendanceData(): Promise<{
  rows: AttendanceRow[];
  people: SchedPerson[];
}> {
  const supabase = await createClient();
  const [weekRes, peopleRes] = await Promise.all([
    supabase
      .from("sched_week")
      .select("id, week_start, status")
      .eq("status", "published"),
    supabase
      .from("person")
      .select(PERSON_COLS)
      .in("status", ["employee", "contractor"])
      .order("last_name"),
  ]);

  const people = (peopleRes.data ?? []) as SchedPerson[];
  const personById = new Map(people.map((p) => [p.id, p]));
  const weeks = (weekRes.data ?? []) as {
    id: string;
    week_start: string;
    status: string;
  }[];
  const weekById = new Map(weeks.map((w) => [w.id, w]));

  const assignments = await fetchAllAssignmentsForWeeks(
    supabase,
    weeks.map((w) => w.id),
  );

  const rows: AttendanceRow[] = assignments.map((a) => {
    const week = weekById.get(a.week_id);
    return {
      assignment: a,
      person: personById.get(a.person_id) ?? null,
      week_start: week?.week_start ?? "",
      published: true,
    };
  });

  return { rows, people };
}

function emptyTally(): ReliabilityTally {
  return {
    total: 0,
    present: 0,
    late: 0,
    late_excused: 0,
    absent: 0,
    absent_excused: 0,
    no_show: 0,
    pto: 0,
    scheduled: 0,
  };
}

/** A single resolved shift for one employee, for the HR Attendance tab. */
export interface PersonAttendanceRecord {
  assignmentId: string;
  work_date: string;
  week_start: string;
  status: AttendanceStatus;
  note: string | null;
  location_name: string | null;
  auto_absent: boolean;
}

export interface PersonAttendanceSummary {
  tally: ReliabilityTally;
  score: number | null;
  records: PersonAttendanceRecord[];
}

/**
 * Attendance rolled up for a single employee from published schedules.
 * Mirrors the Scheduling → Attendance & Reliability view, scoped to one person.
 */
export async function getPersonAttendance(
  personId: string,
): Promise<PersonAttendanceSummary> {
  const supabase = await createClient();
  const [asgRes, weeks, locs] = await Promise.all([
    fetchAllRows<SchedAssignment>((from, to) =>
      supabase
        .from("sched_assignment")
        .select("*")
        .eq("person_id", personId)
        .order("work_date", { ascending: false })
        .range(from, to),
    ),
    getWeekLookupRows(),
    getLocationLookupRows(),
  ]);

  const weekById = new Map(weeks.map((w) => [w.id, w]));
  const locById = new Map(locs.map((l) => [l.id, l]));

  const tally = emptyTally();
  const records: PersonAttendanceRecord[] = [];

  for (const a of asgRes.data as SchedAssignment[]) {
    const week = weekById.get(a.week_id);
    const published = week?.status === "published";
    const status = effectiveAttendance(a, published) as AttendanceStatus;
    tally[status] += 1;
    if (status !== "scheduled") tally.total += 1;

    // Only surface resolved shifts (skip future/unmarked "scheduled").
    if (status === "scheduled") continue;
    const loc = locById.get(a.location_id);
    records.push({
      assignmentId: a.id,
      work_date: a.work_date,
      week_start: week?.week_start ?? "",
      status,
      note: a.attendance_note,
      location_name:
        loc?.display_name || loc?.name || loc?.short_code || null,
      auto_absent: a.auto_absent,
    });
  }

  return { tally, score: reliabilityScore(tally), records };
}

/**
 * Read-only snapshot of a single employee's scheduling configuration, resolved
 * into display-ready labels for the HR profile. The source of truth stays in
 * Schedule → Setup → Employees; this just surfaces it so the same employee data
 * is visible everywhere it's referenced.
 */
export interface PersonScheduleSettings {
  hasSetting: boolean;
  isSchedulable: boolean;
  weeklyTarget: number | null;
  defaultLocationName: string | null;
  /** Empty list means "any location" (no explicit restriction). */
  eligibleLocationNames: string[];
  /** Weekday numbers 0=Sun..6=Sat. Empty means "any day". */
  availableDays: number[];
  roleNames: string[];
  notes: string | null;
}

export async function getPersonScheduleSettings(
  personId: string,
): Promise<PersonScheduleSettings> {
  const supabase = await createClient();
  const [setRes, locs, memRes, roles] = await Promise.all([
    supabase
      .from("sched_employee_setting")
      .select("*")
      .eq("person_id", personId)
      .maybeSingle(),
    getLocationLookupRows(),
    supabase.from("sched_role_member").select("role_id").eq("person_id", personId),
    getRoleLookupRows(),
  ]);

  const setting = (setRes.data as SchedEmployeeSetting | null) ?? null;
  const locById = new Map(locs.map((l) => [l.id, l]));
  const locName = (id: string | null): string | null => {
    if (!id) return null;
    const l = locById.get(id);
    return l?.display_name || l?.name || l?.short_code || null;
  };

  const roleById = new Map(roles.map((r) => [r.id, r.name]));
  const roleNames = ((memRes.data ?? []) as { role_id: string }[])
    .map((m) => roleById.get(m.role_id))
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => a.localeCompare(b));

  return {
    hasSetting: setting != null,
    isSchedulable: setting?.is_schedulable ?? true,
    weeklyTarget: setting?.weekly_shift_target ?? null,
    defaultLocationName: locName(setting?.default_location_id ?? null),
    eligibleLocationNames: (setting?.eligible_location_ids ?? [])
      .map((id) => locName(id))
      .filter((n): n is string => Boolean(n)),
    availableDays: setting?.available_days ?? [],
    roleNames,
    notes: setting?.notes ?? null,
  };
}

/**
 * Editable shift-role eligibility for a single employee, grouped by department.
 * Mirrors the "Roles & Eligibility" data in Schedule → Setup so the employee
 * profile can manage the same `sched_role_member` rows. `selectedRoleIds` is the
 * set of roles this person is currently eligible for.
 */
export interface PersonRoleEligibility {
  departments: { id: string; name: string }[];
  roles: { id: string; department_id: string; name: string }[];
  selectedRoleIds: string[];
}

export async function getPersonEligibility(
  personId: string,
): Promise<PersonRoleEligibility> {
  const supabase = await createClient();
  const [deptRes, roleRes, memRes] = await Promise.all([
    supabase
      .from("sched_department")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("sched_role")
      .select("id, department_id, name")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("sched_role_member")
      .select("role_id")
      .eq("person_id", personId),
  ]);

  return {
    departments: (deptRes.data ?? []) as { id: string; name: string }[],
    roles: (roleRes.data ?? []) as {
      id: string;
      department_id: string;
      name: string;
    }[],
    selectedRoleIds: ((memRes.data ?? []) as { role_id: string }[]).map(
      (m) => m.role_id,
    ),
  };
}

/**
 * Active planning guides enriched with their bookable-slot total, so the
 * schedule can resolve and roll up each staffed day's appointment capacity.
 * Bookable = slots that are not structural (open / block / lunch).
 */
export async function getActiveGuides(): Promise<GuideWithCapacity[]> {
  const supabase = await createClient();
  const [guideRes, colRes, slotRes] = await Promise.all([
    supabase
      .from("planning_guide")
      .select("*")
      .eq("status", "active")
      .order("sort_order")
      .order("name"),
    supabase.from("planning_guide_column").select("id, guide_id"),
    supabase.from("planning_guide_slot").select("guide_id, type_code"),
  ]);

  const guides = (guideRes.data ?? []) as PlanningGuide[];
  const columns = (colRes.data ?? []) as { id: string; guide_id: string }[];
  const slots = (slotRes.data ?? []) as { guide_id: string; type_code: string }[];

  const STRUCTURAL = new Set(["open", "block", "lunch"]);
  const colCount = new Map<string, number>();
  for (const c of columns) colCount.set(c.guide_id, (colCount.get(c.guide_id) ?? 0) + 1);
  const bookable = new Map<string, number>();
  for (const s of slots) {
    if (STRUCTURAL.has(s.type_code)) continue;
    bookable.set(s.guide_id, (bookable.get(s.guide_id) ?? 0) + 1);
  }

  return guides.map((g) => ({
    ...g,
    bookable: bookable.get(g.id) ?? 0,
    columns: colCount.get(g.id) ?? 0,
  }));
}
