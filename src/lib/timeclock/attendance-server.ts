import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { addDays, isIsoDate } from "@/lib/worklist/dates";
import type { AttendanceStatus } from "@/lib/schedule/types";
import {
  DEFAULT_THRESHOLDS,
  attendanceLiveFor,
  gradeShift,
  gradeToAttendance,
  matchSessions,
  type AttendanceThresholds,
  type GradedShift,
  type ShiftInput,
} from "./attendance";
import { TIME_CLOCK_TZ } from "./server";
import {
  buildSessions,
  effectivePunches,
  type EffectivePunch,
  type PunchAdjustment,
  type PunchReview,
  type RawPunch,
  type WorkSession,
} from "./timecard";

// Automatic attendance (go-live item 16): grade published shifts in a date
// range from punches. Service role; callers gate the viewer (canReviewTimeClock
// for the dashboard; the Scheduling module for reliability and the grid).

export interface AttendanceSettings {
  /** timeclock.attendance_from (YYYY-MM-DD), or null when off. */
  liveFrom: string | null;
  thresholds: AttendanceThresholds;
}

const SETTING_KEYS = {
  liveFrom: "timeclock.attendance_from",
  lateGraceMinutes: "timeclock.late_grace_minutes",
  veryLateMinutes: "timeclock.very_late_minutes",
  missedAfterMinutes: "timeclock.missed_after_minutes",
  leftEarlyMinutes: "timeclock.left_early_minutes",
} as const;

export async function getAttendanceSettings(): Promise<AttendanceSettings> {
  const { data } = await createAdminClient()
    .from("app_setting")
    .select("key, value")
    .in("key", Object.values(SETTING_KEYS));
  const byKey = new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const minutes = (key: string, fallback: number) => {
    const v = byKey.get(key);
    return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 24 * 60 ? v : fallback;
  };
  const from = byKey.get(SETTING_KEYS.liveFrom);
  return {
    liveFrom: typeof from === "string" && isIsoDate(from.trim()) ? from.trim() : null,
    thresholds: {
      lateGraceMinutes: minutes(SETTING_KEYS.lateGraceMinutes, DEFAULT_THRESHOLDS.lateGraceMinutes),
      veryLateMinutes: minutes(SETTING_KEYS.veryLateMinutes, DEFAULT_THRESHOLDS.veryLateMinutes),
      missedAfterMinutes: minutes(SETTING_KEYS.missedAfterMinutes, DEFAULT_THRESHOLDS.missedAfterMinutes),
      leftEarlyMinutes: minutes(SETTING_KEYS.leftEarlyMinutes, DEFAULT_THRESHOLDS.leftEarlyMinutes),
    },
  };
}

export interface AttendanceShift extends ShiftInput {
  person_name: string;
  location_name: string;
  label: string | null;
  role: string | null;
  week_id: string;
  /** The manager's manual mark ("scheduled" = none). */
  manual_status: AttendanceStatus;
}

export interface UnscheduledWork {
  person_id: string;
  person_name: string;
  location_id: string | null;
  session: WorkSession<EffectivePunch>;
}

export interface AttendanceDay {
  graded: GradedShift<AttendanceShift, EffectivePunch>[];
  unscheduled: UnscheduledWork[];
}

interface AssignmentRow {
  id: string;
  person_id: string;
  work_date: string;
  location_id: string;
  week_id: string;
  attendance_status: AttendanceStatus;
  sched_week: { status: string; is_template: boolean } | null;
  sched_week_line: { label: string | null; start_time: string | null; end_time: string | null; sched_role: { name: string } | null } | null;
  location: { name: string; display_name: string | null } | null;
  person: { full_name: string | null; first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
}

const nameOf = (p: AssignmentRow["person"]) =>
  [p?.preferred_name || p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.full_name || "Unknown";

/**
 * Grade every published shift with work date in [from, to]. Punches are read
 * a day either side so overnight sessions and late adjustments still match.
 */
export async function gradeRange(
  from: string,
  to: string,
  opts: { now?: Date; settings?: AttendanceSettings; personIds?: string[] } = {},
): Promise<AttendanceDay> {
  const admin = createAdminClient();
  const now = opts.now ?? new Date();
  const settings = opts.settings ?? (await getAttendanceSettings());

  const { data: asg, error: asgErr } = await fetchAllRows<AssignmentRow>((a, b) => {
    let q = admin
      .from("sched_assignment")
      .select(
        "id, person_id, work_date, location_id, week_id, attendance_status, " +
          "sched_week!inner(status, is_template), " +
          "sched_week_line(label, start_time, end_time, sched_role(name)), " +
          "location(name, display_name), person(full_name, first_name, last_name, preferred_name)",
      )
      .eq("sched_week.status", "published")
      .eq("sched_week.is_template", false)
      .eq("removed_post_publish", false)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("id");
    if (opts.personIds) q = q.in("person_id", opts.personIds);
    return q.range(a, b) as unknown as PromiseLike<{ data: AssignmentRow[] | null; error: { message: string } | null }>;
  });
  if (asgErr) throw new Error(`Could not load shifts: ${asgErr.message}`);

  const shifts: AttendanceShift[] = asg.map((r) => ({
    assignment_id: r.id,
    person_id: r.person_id,
    work_date: r.work_date,
    location_id: r.location_id,
    start_time: r.sched_week_line?.start_time ?? null,
    end_time: r.sched_week_line?.end_time ?? null,
    person_name: nameOf(r.person),
    location_name: r.location?.display_name || r.location?.name || "—",
    label: r.sched_week_line?.label ?? null,
    role: r.sched_week_line?.sched_role?.name ?? null,
    week_id: r.week_id,
    manual_status: r.attendance_status,
  }));

  const pFrom = addDays(from, -1);
  const pTo = addDays(to, 1);
  const [punchRes, adjRes, offRes] = await Promise.all([
    fetchAllRows<RawPunch & { person_id: string }>((a, b) => {
      let q = admin
        .from("time_punch")
        .select("id, person_id, punch_type, punched_at, work_date, location_id, rest_breaks_ok, location_check, needs_approval, assignment_id")
        .gte("work_date", pFrom)
        .lte("work_date", pTo)
        .order("id");
      if (opts.personIds) q = q.in("person_id", opts.personIds);
      return q.range(a, b);
    }),
    fetchAllRows<PunchAdjustment & { person_id: string }>((a, b) => {
      let q = admin
        .from("time_punch_adjustment")
        .select("id, person_id, action, punch_type, punched_at, work_date, voids_punch_id, voids_adjustment_id, reason, created_at")
        .gte("work_date", pFrom)
        .lte("work_date", pTo)
        .order("id");
      if (opts.personIds) q = q.in("person_id", opts.personIds);
      return q.range(a, b);
    }),
    fetchAllRows<{ person_id: string; start_date: string; end_date: string }>((a, b) => {
      let q = admin
        .from("person_time_off")
        .select("person_id, start_date, end_date")
        .eq("status", "approved")
        .lte("start_date", to)
        .gte("end_date", from)
        .order("id");
      if (opts.personIds) q = q.in("person_id", opts.personIds);
      return q.range(a, b);
    }),
  ]);
  for (const r of [punchRes, adjRes, offRes]) if (r.error) throw new Error(`Could not load attendance data: ${r.error.message}`);

  const pendingIds = punchRes.data.filter((p) => p.needs_approval).map((p) => p.id);
  let reviews: PunchReview[] = [];
  if (pendingIds.length) {
    const { data } = await admin.from("time_punch_review").select("punch_id, decision").in("punch_id", pendingIds);
    reviews = (data ?? []) as PunchReview[];
  }

  const people = new Set([...shifts.map((s) => s.person_id), ...punchRes.data.map((p) => p.person_id), ...adjRes.data.map((a) => a.person_id)]);
  const names = new Map(shifts.map((s) => [s.person_id, s.person_name]));
  const missingNames = [...people].filter((id) => !names.has(id));
  if (missingNames.length) {
    const { data } = await admin.from("person").select("id, full_name, first_name, last_name, preferred_name").in("id", missingNames);
    for (const p of (data ?? []) as (AssignmentRow["person"] & { id: string })[]) names.set(p.id, nameOf(p));
  }

  const graded: AttendanceDay["graded"] = [];
  const unscheduled: UnscheduledWork[] = [];
  for (const personId of people) {
    const mine = shifts.filter((s) => s.person_id === personId);
    const eff = effectivePunches(
      punchRes.data.filter((p) => p.person_id === personId),
      adjRes.data.filter((a) => a.person_id === personId),
      reviews,
    );
    const sessions = buildSessions(eff, now).filter((s) => s.work_date >= from && s.work_date <= to);
    const { bySession, unscheduled: extra } = matchSessions(mine, sessions, TIME_CLOCK_TZ);
    const off = offRes.data.filter((o) => o.person_id === personId);
    for (const shift of mine) {
      const onPto = off.some((o) => o.start_date <= shift.work_date && o.end_date >= shift.work_date);
      graded.push(
        gradeShift(shift, bySession.get(shift.assignment_id) ?? null, {
          now,
          timeZone: TIME_CLOCK_TZ,
          thresholds: settings.thresholds,
          onPto,
        }),
      );
    }
    for (const session of extra) {
      unscheduled.push({
        person_id: personId,
        person_name: names.get(personId) ?? "Unknown",
        location_id: session.location_id,
        session,
      });
    }
  }
  return { graded, unscheduled };
}

/**
 * Time-clock attendance for unmarked shifts in [from, to], from the live date
 * on (empty when attendance is off). Used by reliability and the grid: a
 * manual mark always wins, so only "scheduled" shifts get a value.
 */
export async function systemAttendance(
  from: string,
  to: string,
  opts: { personIds?: string[]; today: string },
): Promise<Record<string, AttendanceStatus>> {
  const settings = await getAttendanceSettings();
  if (!settings.liveFrom) return {};
  const start = from < settings.liveFrom ? settings.liveFrom : from;
  const end = to > opts.today ? opts.today : to;
  if (start > end) return {};
  const { graded } = await gradeRange(start, end, { settings, personIds: opts.personIds });
  const out: Record<string, AttendanceStatus> = {};
  for (const g of graded) {
    if (g.shift.manual_status !== "scheduled") continue;
    if (!attendanceLiveFor(g.shift.work_date, settings.liveFrom)) continue;
    out[g.shift.assignment_id] = gradeToAttendance(g);
  }
  return out;
}
