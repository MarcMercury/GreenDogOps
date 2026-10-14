import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { AttendanceAssignment } from "@/features/scheduling/attendance/types/attendance-row";

/**
 * The only assignment columns the attendance rollup reads. `select("*")` pulled
 * all nineteen for every shift in every published week, which is most of the
 * payload and none of it used.
 *
 * `attendance_status`, `work_date` and `removed_post_publish` are required
 * together: effectiveAttendance() treats a still-"scheduled" shift on a
 * published past date as present, so dropping any of them changes the tallies.
 */
const ATTENDANCE_ASSIGNMENT_COLS =
  "id, week_id, person_id, work_date, attendance_status, removed_post_publish";

/**
 * Fetch every row matching a `week_id IN (...)` filter, paging past PostgREST's
 * `max_rows` cap (1000). Without this the attendance rollup silently loses the
 * oldest published shifts once the schedule grows beyond a single page.
 *
 * Pages are counted first and then fetched together. Walking them one after the
 * other costs a round trip per thousand rows, which grows with the schedule.
 */
export async function fetchAllAssignmentsForWeeks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  weekIds: string[],
): Promise<AttendanceAssignment[]> {
  if (weekIds.length === 0) return [];
  const PAGE = 1000;

  const page = (from: number) =>
    supabase
      .from("sched_assignment")
      .select(ATTENDANCE_ASSIGNMENT_COLS)
      .in("week_id", weekIds)
      .order("work_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

  const { count, error: countErr } = await supabase
    .from("sched_assignment")
    .select("id", { count: "exact", head: true })
    .in("week_id", weekIds);
  if (countErr) return [];

  const total = count ?? 0;
  if (total === 0) return [];

  const offsets = Array.from(
    { length: Math.ceil(total / PAGE) },
    (_, i) => i * PAGE,
  );
  const pages = await Promise.all(offsets.map((from) => page(from)));
  return pages.flatMap((p) => (p.data ?? []) as unknown as AttendanceAssignment[]);
}
