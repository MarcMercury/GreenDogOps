import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SchedPerson } from "@/lib/schedule/types";

const PERSON_COLS = "id, first_name, last_name, grid_name, full_name";

/** Active employees/contractors available to search for scheduled shifts. */
export async function getSearchPeople(): Promise<SchedPerson[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("person")
    .select(PERSON_COLS)
    .in("status", ["employee", "contractor"])
    .order("last_name")
    .order("first_name");
  return (data ?? []) as SchedPerson[];
}

/** One scheduled workday for a person, resolved with location + shift times. */
export interface ShiftHit {
  person_id: string;
  work_date: string; // ISO date (YYYY-MM-DD)
  day_of_week: number; // 0=Sun..6=Sat
  location_id: string;
  location_name: string;
  location_color: string | null;
  start_time: string | null;
  end_time: string | null;
  label: string | null;
}

type AssignmentRow = {
  person_id: string;
  location_id: string;
  work_date: string;
  day_of_week: number;
  line_id: string;
  week_id: string;
  removed_post_publish: boolean;
};

/** Week statuses that count as a real, matchable schedule. */
const MATCHABLE_STATUSES = new Set(["published", "pending_approval"]);

/**
 * Scheduled workdays for the given people within [startDate, endDate].
 * Weeks that are published or pending approval are included (the schedules
 * people rely on / are about to rely on); shifts removed after publish are
 * excluded.
 */
export async function searchShifts(
  personIds: string[],
  startDate: string,
  endDate: string,
): Promise<ShiftHit[]> {
  const ids = personIds.filter(Boolean);
  if (ids.length === 0 || !startDate || !endDate || startDate > endDate) {
    return [];
  }
  const supabase = await createClient();

  const [weekRes, assignRes] = await Promise.all([
    supabase.from("sched_week").select("id, status"),
    supabase
      .from("sched_assignment")
      .select(
        "person_id, location_id, work_date, day_of_week, line_id, week_id, removed_post_publish",
      )
      .in("person_id", ids)
      .gte("work_date", startDate)
      .lte("work_date", endDate)
      .order("work_date"),
  ]);

  const publishedWeekIds = new Set(
    ((weekRes.data ?? []) as { id: string; status: string }[])
      .filter((w) => MATCHABLE_STATUSES.has(w.status))
      .map((w) => w.id),
  );

  const assignments = ((assignRes.data ?? []) as AssignmentRow[]).filter(
    (a) => !a.removed_post_publish && publishedWeekIds.has(a.week_id),
  );
  if (assignments.length === 0) return [];

  const lineIds = [...new Set(assignments.map((a) => a.line_id))];
  const locationIds = [...new Set(assignments.map((a) => a.location_id))];

  const [lineRes, locRes] = await Promise.all([
    supabase
      .from("sched_week_line")
      .select("id, start_time, end_time, label")
      .in("id", lineIds),
    supabase
      .from("location")
      .select("id, name, short_code, color")
      .in("id", locationIds),
  ]);

  const lineMap = new Map(
    (
      (lineRes.data ?? []) as {
        id: string;
        start_time: string | null;
        end_time: string | null;
        label: string | null;
      }[]
    ).map((l) => [l.id, l]),
  );
  const locMap = new Map(
    (
      (locRes.data ?? []) as {
        id: string;
        name: string | null;
        short_code: string | null;
        color: string | null;
      }[]
    ).map((l) => [l.id, l]),
  );

  return assignments.map((a) => {
    const line = lineMap.get(a.line_id);
    const loc = locMap.get(a.location_id);
    return {
      person_id: a.person_id,
      work_date: a.work_date,
      day_of_week: a.day_of_week,
      location_id: a.location_id,
      location_name: loc?.short_code || loc?.name || "—",
      location_color: loc?.color ?? null,
      start_time: line?.start_time ?? null,
      end_time: line?.end_time ?? null,
      label: line?.label ?? null,
    };
  });
}
