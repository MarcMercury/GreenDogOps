import "server-only";
import { createClient } from "@/lib/supabase/server";
import { LOCATION_COLUMNS } from "@/lib/shared/locations";
import type {
  ScheduleLocation,
  SchedAssignment,
  SchedClosure,
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

const PERSON_COLS =
  "id, first_name, last_name, preferred_name, grid_name, full_name";

/** Active practice locations, ordered for the grid. */
export async function getLocations(): Promise<ScheduleLocation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("location")
    .select(LOCATION_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as unknown as ScheduleLocation[];
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
  assignments: SchedAssignment[];
}

/** Full grid payload for a single week. */
export async function getWeekData(weekId: string): Promise<WeekData | null> {
  const supabase = await createClient();
  const week = await getWeek(weekId);
  if (!week) return null;

  const [lineRes, locRes, closeRes, asgRes] = await Promise.all([
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
    supabase.from("sched_assignment").select("*").eq("week_id", weekId),
  ]);

  return {
    week,
    lines: (lineRes.data ?? []) as SchedWeekLine[],
    weekLocations: (locRes.data ?? []) as SchedWeekLocation[],
    closures: (closeRes.data ?? []) as SchedClosure[],
    assignments: (asgRes.data ?? []) as SchedAssignment[],
  };
}

export interface AttendanceRow {
  assignment: SchedAssignment;
  person: SchedPerson | null;
  week_start: string;
  published: boolean;
}

/** Resolved-attendance assignments across published weeks, for the rollup. */
export async function getAttendanceData(): Promise<{
  rows: AttendanceRow[];
  people: SchedPerson[];
}> {
  const supabase = await createClient();
  const [asgRes, weekRes, peopleRes] = await Promise.all([
    supabase
      .from("sched_assignment")
      .select("*")
      .order("work_date", { ascending: false }),
    supabase.from("sched_week").select("id, week_start, status"),
    supabase
      .from("person")
      .select(PERSON_COLS)
      .in("status", ["employee", "contractor"])
      .order("last_name"),
  ]);

  const people = (peopleRes.data ?? []) as SchedPerson[];
  const personById = new Map(people.map((p) => [p.id, p]));
  const weekById = new Map(
    (
      (weekRes.data ?? []) as { id: string; week_start: string; status: string }[]
    ).map((w) => [w.id, w]),
  );

  const rows: AttendanceRow[] = ((asgRes.data ?? []) as SchedAssignment[]).map(
    (a) => {
      const week = weekById.get(a.week_id);
      return {
        assignment: a,
        person: personById.get(a.person_id) ?? null,
        week_start: week?.week_start ?? "",
        published: week?.status === "published",
      };
    },
  );

  return { rows, people };
}
