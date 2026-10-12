import "server-only";

// ---------------------------------------------------------------------------
// Scheduling, attendance and time-off notification events.
//
// Called from the Schedule / HR Server Actions (via runInBackground) and the
// When I Work import after the change has been saved. Every function loads
// what it needs with the service role, builds the payload, and hands it to
// emitEvent(); none of them throws.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { shortDateLabel, todayInWorkTz } from "@/lib/worklist/dates";
import { ATTENDANCE_LABELS, timeRange, weekStartFor, type AttendanceStatus } from "@/lib/schedule/types";
import { emitEvent } from "../emit";
import { personDisplayName } from "../directory";
import { dateRangeLabel } from "../format";
import {
  coverageCandidates,
  MISSED_SHIFT_ATTENDANCE,
  shiftsByPerson,
  timeOffKindLabel,
  UNCOVERED_ATTENDANCE,
  weekIsPast,
  type ShiftRow,
} from "./schedule-rules";

type Admin = ReturnType<typeof createAdminClient>;

interface WeekRow {
  id: string;
  week_start: string;
  status: string;
  is_template: boolean;
  published_at: string | null;
}

interface LineJoin {
  start_time: string | null;
  end_time: string | null;
  label: string | null;
  role_id: string | null;
  role: { name: string } | { name: string }[] | null;
}

interface AssignmentJoin {
  id: string;
  person_id: string;
  work_date: string;
  location_id: string;
  removed_post_publish: boolean;
  line: LineJoin | LineJoin[] | null;
  location: { name: string; short_code: string | null } | { name: string; short_code: string | null }[] | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

const ASSIGNMENT_SELECT =
  "id, person_id, work_date, location_id, removed_post_publish, line:line_id (start_time, end_time, label, role_id, role:role_id (name)), location:location_id (name, short_code)";

function toShift(a: AssignmentJoin): ShiftRow {
  const line = one(a.line);
  const role = one(line?.role ?? null);
  return {
    person_id: a.person_id,
    work_date: a.work_date,
    location_name: one(a.location)?.name ?? null,
    start_time: line?.start_time ?? null,
    end_time: line?.end_time ?? null,
    label: line?.label?.trim() || role?.name || null,
  };
}

async function loadWeek(admin: Admin, weekId: string): Promise<WeekRow | null> {
  const { data } = await admin
    .from("sched_week")
    .select("id, week_start, status, is_template, published_at")
    .eq("id", weekId)
    .maybeSingle();
  return (data as WeekRow | null) ?? null;
}

async function personName(admin: Admin, personId: string): Promise<string> {
  const { data } = await admin
    .from("person")
    .select("full_name, first_name, last_name, preferred_name")
    .eq("id", personId)
    .maybeSingle();
  return data ? personDisplayName(data as Parameters<typeof personDisplayName>[0]) : "Someone";
}

// ---------------------------------------------------------------------------
// Schedule published → each scheduled employee gets only their own shifts
// ---------------------------------------------------------------------------

export async function notifySchedulePublished(weekId: string, actorUserId: string | null): Promise<void> {
  const admin = createAdminClient();
  const week = await loadWeek(admin, weekId);
  if (!week || week.status !== "published" || week.is_template) return;
  if (weekIsPast(week.week_start, todayInWorkTz())) return;

  const { data, error } = await admin
    .from("sched_assignment")
    .select(ASSIGNMENT_SELECT)
    .eq("week_id", weekId)
    .eq("removed_post_publish", false)
    .limit(5000);
  if (error) {
    console.error(`[notify] schedule.published ${weekId}: ${error.message}`);
    return;
  }
  const shifts = shiftsByPerson(((data ?? []) as unknown as AssignmentJoin[]).map(toShift));
  const people = [...shifts.keys()];
  await emitEvent({
    type: "schedule.published",
    subjectType: "sched_week",
    subjectId: weekId,
    subjectPersonIds: people,
    actorUserId,
    payload: {
      weekId,
      weekStart: week.week_start,
      peopleCount: people.length,
      shifts: Object.fromEntries(shifts),
    },
    // Re-publishing after a revert notifies again; a double click doesn't.
    dedupeKey: `schedule.published:${weekId}:${week.published_at ?? ""}`,
  });
}

// ---------------------------------------------------------------------------
// Shift changed on a published week → that employee (batched)
// ---------------------------------------------------------------------------

const CHANGE_TEXT: Record<string, string> = {
  added: "A shift was added",
  removed: "A shift was removed",
  relocated: "A shift was moved",
  auto_absent: "You were taken off a shift",
};

export async function notifyShiftChanged(input: {
  weekId: string;
  personId: string;
  action: string;
  workDate?: string | null;
  actorUserId: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const week = await loadWeek(admin, input.weekId);
  if (!week || week.status !== "published" || week.is_template) return;
  const today = todayInWorkTz();
  if (weekIsPast(week.week_start, today)) return;
  if (input.workDate && input.workDate < today) return;

  const { data } = await admin
    .from("sched_assignment")
    .select(ASSIGNMENT_SELECT)
    .eq("week_id", input.weekId)
    .eq("person_id", input.personId)
    .eq("removed_post_publish", false);
  const shifts = shiftsByPerson(((data ?? []) as unknown as AssignmentJoin[]).map(toShift)).get(input.personId) ?? [];
  const base = CHANGE_TEXT[input.action] ?? "Your shifts were updated";
  const change = input.workDate ? `${base} (${shortDateLabel(input.workDate)}).` : `${base}.`;

  await emitEvent({
    type: "schedule.shift_changed",
    subjectType: "sched_week",
    subjectId: input.weekId,
    subjectPersonIds: [input.personId],
    actorUserId: input.actorUserId,
    payload: {
      weekId: input.weekId,
      weekStart: week.week_start,
      personId: input.personId,
      personName: await personName(admin, input.personId),
      change,
      shifts,
    },
  });
}

// ---------------------------------------------------------------------------
// Attendance → coverage needed / missed shift
// ---------------------------------------------------------------------------

export async function notifyAttendanceChange(input: {
  assignmentId: string;
  status: AttendanceStatus | "auto_absent";
  note?: string | null;
  actorUserId: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sched_assignment")
    .select(`${ASSIGNMENT_SELECT}, week_id`)
    .eq("id", input.assignmentId)
    .maybeSingle();
  const a = data as (AssignmentJoin & { week_id: string }) | null;
  if (!a) return;
  const week = await loadWeek(admin, a.week_id);
  if (!week || week.status !== "published" || week.is_template) return;

  const shift = toShift(a);
  const name = await personName(admin, a.person_id);
  const dateLabel = shortDateLabel(a.work_date);
  const statusKey = input.status === "auto_absent" ? "absent" : input.status;
  const today = todayInWorkTz();

  if (MISSED_SHIFT_ATTENDANCE.has(statusKey)) {
    await emitEvent({
      type: "attendance.missed_shift",
      subjectType: "sched_assignment",
      subjectId: a.id,
      subjectPersonIds: [a.person_id],
      locationId: a.location_id,
      actorUserId: input.actorUserId,
      payload: {
        weekId: a.week_id,
        personName: name,
        statusLabel: ATTENDANCE_LABELS[statusKey as AttendanceStatus] ?? statusKey,
        dateLabel,
        locationName: shift.location_name ?? "",
        note: input.note?.trim().slice(0, 200) ?? "",
      },
      dedupeKey: `attendance.missed_shift:${a.id}`,
    });
  }

  if (UNCOVERED_ATTENDANCE.has(statusKey) && a.work_date >= today) {
    const candidates = await findCoverageCandidates(admin, a);
    await emitEvent({
      type: "schedule.coverage_needed",
      subjectType: "sched_assignment",
      subjectId: a.id,
      subjectPersonIds: [],
      candidatePersonIds: candidates,
      locationId: a.location_id,
      actorUserId: input.actorUserId,
      payload: {
        weekId: a.week_id,
        personName: name,
        dateLabel,
        roleLabel: shift.label ?? "",
        time: timeRange(shift.start_time, shift.end_time),
        locationName: shift.location_name ?? "",
        reason: input.status === "auto_absent" ? "Removed from the schedule" : (ATTENDANCE_LABELS[statusKey as AttendanceStatus] ?? statusKey),
      },
      dedupeKey: `schedule.coverage_needed:${a.id}`,
    });
  }
}

async function findCoverageCandidates(admin: Admin, a: AssignmentJoin): Promise<string[]> {
  const roleId = one(a.line)?.role_id;
  if (!roleId) return [];
  const [members, scheduled, off, active] = await Promise.all([
    admin.from("sched_role_member").select("person_id").eq("role_id", roleId),
    admin
      .from("sched_assignment")
      .select("person_id")
      .eq("work_date", a.work_date)
      .eq("removed_post_publish", false),
    admin
      .from("person_time_off")
      .select("person_id")
      .in("status", ["requested", "approved"])
      .lte("start_date", a.work_date)
      .gte("end_date", a.work_date),
    admin.from("person").select("id").in("status", ["employee", "contractor"]).limit(5000),
  ]);
  return coverageCandidates({
    roleMemberIds: ((members.data ?? []) as { person_id: string }[]).map((r) => r.person_id),
    activePersonIds: new Set(((active.data ?? []) as { id: string }[]).map((r) => r.id)),
    scheduledThatDay: new Set(((scheduled.data ?? []) as { person_id: string }[]).map((r) => r.person_id)),
    offThatDay: new Set(((off.data ?? []) as { person_id: string }[]).map((r) => r.person_id)),
    absentPersonId: a.person_id,
  });
}

// ---------------------------------------------------------------------------
// Time off
// ---------------------------------------------------------------------------

interface TimeOffRow {
  id: string;
  person_id: string;
  kind: string;
  status: string;
  start_date: string;
  end_date: string;
  note: string | null;
}

async function timeOffPayload(admin: Admin, t: TimeOffRow): Promise<Record<string, unknown>> {
  const [name, employment, week] = await Promise.all([
    personName(admin, t.person_id),
    admin
      .from("person_employment")
      .select("location:location_id (name)")
      .eq("person_id", t.person_id)
      .maybeSingle(),
    admin
      .from("sched_week")
      .select("id")
      .eq("week_start", weekStartFor(new Date(`${t.start_date}T12:00:00`)))
      .eq("is_template", false)
      .limit(1),
  ]);
  const loc = one((employment.data as { location: { name: string } | { name: string }[] | null } | null)?.location ?? null);
  const weekId = ((week.data as { id: string }[] | null) ?? [])[0]?.id;
  return {
    timeOffId: t.id,
    personName: name,
    dates: dateRangeLabel(t.start_date, t.end_date),
    kindLabel: timeOffKindLabel(t.kind),
    locationName: loc?.name ?? "",
    note: t.note?.trim() ?? "",
    href: weekId ? `/schedule?week=${weekId}` : "/schedule",
  };
}

async function loadTimeOff(admin: Admin, id: string): Promise<TimeOffRow | null> {
  const { data } = await admin
    .from("person_time_off")
    .select("id, person_id, kind, status, start_date, end_date, note")
    .eq("id", id)
    .maybeSingle();
  return (data as TimeOffRow | null) ?? null;
}

export async function notifyTimeOffRequested(timeOffId: string, actorUserId: string | null): Promise<void> {
  const admin = createAdminClient();
  const t = await loadTimeOff(admin, timeOffId);
  if (!t || t.status !== "requested") return;
  if (t.end_date < todayInWorkTz()) return;
  await emitEvent({
    type: "pto.requested",
    subjectType: "time_off",
    subjectId: t.id,
    subjectPersonIds: [t.person_id],
    actorUserId,
    payload: await timeOffPayload(admin, t),
    dedupeKey: `pto.requested:${t.id}`,
  });
}

/** A request was approved / denied (from Ops or a Slack button). */
export async function notifyTimeOffDecided(input: {
  timeOffId: string;
  status: "approved" | "denied";
  reviewerName: string;
  actorUserId: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const t = await loadTimeOff(admin, input.timeOffId);
  if (!t || t.status !== input.status) return;
  const payload = { ...(await timeOffPayload(admin, t)), reviewerName: input.reviewerName };
  await emitEvent({
    type: input.status === "approved" ? "pto.approved" : "pto.denied",
    subjectType: "time_off",
    subjectId: t.id,
    subjectPersonIds: [t.person_id],
    actorUserId: input.actorUserId,
    payload,
    dedupeKey: `pto.${input.status}:${t.id}:${Date.now()}`,
    resolve: {
      messageKey: `pto:${t.id}`,
      note: `${input.status === "approved" ? "✅ Approved" : "❌ Denied"} by ${input.reviewerName}`,
    },
  });
}

/** Reopened, edited by an import, or withdrawn (pass the row loaded before deleting). */
export async function notifyTimeOffModified(input: {
  timeOffId: string;
  change: "reopened" | "updated" | "withdrawn";
  before?: TimeOffRow | null;
  actorUserId: string | null;
  actorName?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const t = input.before ?? (await loadTimeOff(admin, input.timeOffId));
  if (!t || t.end_date < todayInWorkTz()) return;
  const by = input.actorName ? ` by ${input.actorName}` : "";
  await emitEvent({
    type: "pto.modified",
    subjectType: "time_off",
    subjectId: t.id,
    subjectPersonIds: [t.person_id],
    actorUserId: input.actorUserId,
    payload: { ...(await timeOffPayload(admin, t)), change: input.change },
    dedupeKey: `pto.modified:${t.id}:${input.change}:${Date.now()}`,
    resolve:
      input.change === "updated"
        ? null
        : { messageKey: `pto:${t.id}`, note: input.change === "withdrawn" ? `🗑️ Withdrawn${by}` : `↩️ Reopened${by}` },
  });
  // A reopened request needs a decision again.
  if (input.change === "reopened") {
    await emitEvent({
      type: "pto.requested",
      subjectType: "time_off",
      subjectId: t.id,
      subjectPersonIds: [t.person_id],
      actorUserId: input.actorUserId,
      payload: await timeOffPayload(admin, t),
      dedupeKey: `pto.requested:${t.id}:reopened:${Date.now()}`,
    });
  }
}

export type { TimeOffRow };
