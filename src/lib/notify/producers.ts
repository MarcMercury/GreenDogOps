import "server-only";

// ---------------------------------------------------------------------------
// Time-based notification producers, run by the 5-minute dispatcher.
//
//   escalations       an action-required event (e.g. a PTO request) still
//                     open after the rule's escalate_after_hours → re-notify
//                     the rule's escalation roles once.
//   event reminders   marketing events starting tomorrow → their staff, once,
//                     from 10am Pacific.
//   unpublished week  from 10am Pacific: the current week, or (from Thursday)
//                     next week, isn't published → schedulers, once a day.
//   attendance        once time-clock attendance is on (Admin ▸ Settings):
//                     a shift with no clock-in by the missed window →
//                     attendance.missed_shift; a late clock-in → attendance.late.
//                     Unmarked shifts only; once per shift.
//   missing clock-out someone still clocked in an hour after their shift
//                     ended (12 h with no shift) → them + clinic managers,
//                     once per clock-in.
//
// Both are idempotent (escalated_at / dedupe keys), so overlapping runs are safe.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, shortDateLabel, todayInWorkTz, WORK_TZ } from "@/lib/worklist/dates";
import { createEvent, loadRule, processEvent, type NotificationEventRow } from "./engine";
import { EVENT_REGISTRY } from "./registry";
import { MARKETING_EVENT_COLUMNS, isCanceled, marketingPayload, staffIds, type MarketingEventRow } from "./events/marketing-rules";
import { personDisplayName } from "./directory";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { formatClockTime } from "@/lib/timeclock/local-time";
import { isClockOutOverdue, MISSING_CLOCK_OUT_MAX_AGE_DAYS } from "@/lib/timeclock/missing";
import { formatShiftTime } from "@/lib/timeclock/shift-match";
import { publishUrgency, PUBLISH_REMINDER_HOUR, weeksNeedingReminder } from "@/lib/schedule/publish";
import { SCHEDULE_STATUS_LABELS, type ScheduleStatus } from "@/lib/schedule/types";
import { attendanceLiveFor } from "@/lib/timeclock/attendance";
import { getAttendanceSettings, gradeRange } from "@/lib/timeclock/attendance-server";

type Admin = ReturnType<typeof createAdminClient>;

/** Ids of subjects whose action is still outstanding, per event type. */
const STILL_OPEN: Record<string, (admin: Admin, subjectIds: string[]) => Promise<Set<string>>> = {
  "pto.requested": async (admin, ids) => {
    const { data } = await admin.from("person_time_off").select("id").in("id", ids).eq("status", "requested");
    return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  },
  // Off-site punch with no decision and not voided by a correction.
  "timeclock.offsite_pending": async (admin, ids) => {
    const [reviews, voids] = await Promise.all([
      admin.from("time_punch_review").select("punch_id").in("punch_id", ids),
      admin.from("time_punch_adjustment").select("voids_punch_id").in("voids_punch_id", ids),
    ]);
    const done = new Set([
      ...((reviews.data ?? []) as { punch_id: string }[]).map((r) => r.punch_id),
      ...((voids.data ?? []) as { voids_punch_id: string }[]).map((r) => r.voids_punch_id),
    ]);
    return new Set(ids.filter((id) => !done.has(id)));
  },
  "timeclock.correction_requested": async (admin, ids) => {
    const { data } = await admin.from("time_correction_request").select("id").in("id", ids).eq("status", "pending");
    return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  },
};

export async function runProducers(now = new Date()): Promise<number> {
  let produced = 0;
  try {
    produced += await produceEscalations(now);
  } catch (err) {
    console.error("[notify] escalations:", err instanceof Error ? err.message : err);
  }
  try {
    produced += await produceEventReminders(now);
  } catch (err) {
    console.error("[notify] event reminders:", err instanceof Error ? err.message : err);
  }
  try {
    produced += await produceUnpublishedReminders(now);
  } catch (err) {
    console.error("[notify] unpublished reminders:", err instanceof Error ? err.message : err);
  }
  try {
    produced += await produceAttendanceAlerts(now);
  } catch (err) {
    console.error("[notify] attendance alerts:", err instanceof Error ? err.message : err);
  }
  try {
    produced += await produceMissingClockOuts(now);
  } catch (err) {
    console.error("[notify] missing clock-outs:", err instanceof Error ? err.message : err);
  }
  return produced;
}

async function produceUnpublishedReminders(now: Date): Promise<number> {
  if (hourInWorkTz(now) < PUBLISH_REMINDER_HOUR) return 0;
  const def = EVENT_REGISTRY.get("schedule.unpublished_reminder");
  if (!def) return 0;
  const { rule } = await loadRule(def);
  if (!rule.enabled) return 0;

  const admin = createAdminClient();
  const today = todayInWorkTz(now);
  const starts = weeksNeedingReminder(today);
  const { data } = await admin
    .from("sched_week")
    .select("id, week_start, status")
    .eq("is_template", false)
    .in("week_start", starts);
  const byStart = new Map(((data ?? []) as { id: string; week_start: string; status: ScheduleStatus }[]).map((w) => [w.week_start, w]));
  let produced = 0;
  for (const weekStart of starts) {
    const week = byStart.get(weekStart) ?? null;
    const urgency = publishUrgency(weekStart, week?.status ?? "draft", today);
    if (!urgency) continue;
    const created = await createEvent({
      type: "schedule.unpublished_reminder",
      subjectType: "sched_week",
      subjectId: week?.id ?? null,
      payload: {
        weekId: week?.id ?? "",
        weekStart,
        urgency,
        statusLabel: week ? SCHEDULE_STATUS_LABELS[week.status] : "",
      },
      dedupeKey: `schedule.unpublished_reminder:${weekStart}:${today}`,
    });
    if (created.ok && !created.duplicate) {
      await processEvent(created.id);
      produced++;
    }
  }
  return produced;
}

async function produceAttendanceAlerts(now: Date): Promise<number> {
  const settings = await getAttendanceSettings();
  if (!settings.liveFrom) return 0;
  const today = todayInWorkTz(now);
  const from = addDays(today, -1);
  if (today < settings.liveFrom) return 0;
  const { graded } = await gradeRange(from < settings.liveFrom ? settings.liveFrom : from, today, { now, settings });

  let produced = 0;
  const emit = async (input: Parameters<typeof createEvent>[0]) => {
    const created = await createEvent(input);
    if (created.ok && !created.duplicate) {
      await processEvent(created.id);
      produced++;
    }
  };
  for (const g of graded) {
    const s = g.shift;
    if (s.manual_status !== "scheduled" || !attendanceLiveFor(s.work_date, settings.liveFrom)) continue;
    const shift = s.start_time ? `${formatShiftTime(s.start_time)}${s.end_time ? ` – ${formatShiftTime(s.end_time)}` : ""}` : "";
    if (g.state === "missed") {
      // Same key as a manager marking No-show, so the alert never goes twice.
      await emit({
        type: "attendance.missed_shift",
        subjectType: "sched_assignment",
        subjectId: s.assignment_id,
        subjectPersonIds: [s.person_id],
        locationId: s.location_id,
        payload: {
          weekId: s.week_id,
          personName: s.person_name,
          statusLabel: "Missed (no clock-in)",
          dateLabel: shortDateLabel(s.work_date),
          locationName: s.location_name,
          note: shift ? `Shift ${shift}` : "",
        },
        dedupeKey: `attendance.missed_shift:${s.assignment_id}`,
      });
    } else if (g.lateLevel && g.session?.clock_in && g.lateMinutes !== null) {
      await emit({
        type: "attendance.late",
        subjectType: "sched_assignment",
        subjectId: s.assignment_id,
        subjectPersonIds: [s.person_id],
        locationId: s.location_id,
        payload: {
          personName: s.person_name,
          minutesLate: String(g.lateMinutes),
          dateLabel: shortDateLabel(s.work_date),
          shift,
          clockIn: formatClockTime(g.session.clock_in, WORK_TZ),
          locationName: s.location_name,
        },
        dedupeKey: `attendance.late:${s.assignment_id}`,
      });
    }
  }
  return produced;
}

async function produceMissingClockOuts(now: Date): Promise<number> {
  const def = EVENT_REGISTRY.get("timeclock.missing_clock_out");
  if (!def) return 0;
  const { rule } = await loadRule(def);
  if (!rule.enabled) return 0;

  const admin = createAdminClient();
  const since = new Date(now.getTime() - (MISSING_CLOCK_OUT_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
  const { data: raw, error } = await fetchAllRows<{ person_id: string; punch_type: string; punched_at: string }>((a, b) =>
    admin.from("time_punch").select("person_id, punch_type, punched_at").gte("punched_at", since).order("id").range(a, b),
  );
  if (error) throw new Error(error.message);

  // Cheap pre-filter on raw punches: people whose latest punch isn't a clock-out.
  const latest = new Map<string, { punch_type: string; punched_at: string }>();
  for (const p of raw) {
    const cur = latest.get(p.person_id);
    if (!cur || p.punched_at > cur.punched_at) latest.set(p.person_id, p);
  }
  const candidates = [...latest.entries()].filter(([, p]) => p.punch_type !== "clock_out").map(([id]) => id);

  let produced = 0;
  for (const personId of candidates) {
    // Effective punches (approver adds/voids applied) decide whether it's still open.
    const { data: eff } = await admin
      .rpc("time_effective_punches", { p_person_id: personId })
      .gte("punched_at", since)
      .order("punched_at", { ascending: false })
      .limit(20);
    const rows = (eff ?? []) as { id: string; punch_type: string; punched_at: string; work_date: string; location_id: string | null; assignment_id: string | null }[];
    if (!rows.length || rows[0].punch_type === "clock_out") continue;
    const clockIn = rows.find((r) => r.punch_type === "clock_in");
    if (!clockIn) continue;

    let shiftStart: string | null = null;
    let shiftEnd: string | null = null;
    if (clockIn.assignment_id) {
      const { data: asg } = await admin
        .from("sched_assignment")
        .select("sched_week_line(start_time, end_time)")
        .eq("id", clockIn.assignment_id)
        .maybeSingle();
      const line = (asg as { sched_week_line: { start_time: string | null; end_time: string | null } | null } | null)?.sched_week_line;
      shiftStart = line?.start_time ?? null;
      shiftEnd = line?.end_time ?? null;
    }
    if (!isClockOutOverdue({ clockInAt: clockIn.punched_at, workDate: clockIn.work_date, shiftStart, shiftEnd }, now, WORK_TZ)) continue;

    const [{ data: person }, { data: loc }] = await Promise.all([
      admin.from("person").select("full_name, first_name, last_name, preferred_name").eq("id", personId).maybeSingle(),
      clockIn.location_id
        ? admin.from("location").select("name, display_name").eq("id", clockIn.location_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const l = loc as { name: string; display_name: string | null } | null;
    const created = await createEvent({
      type: "timeclock.missing_clock_out",
      subjectType: "time_punch",
      subjectId: clockIn.id,
      subjectPersonIds: [personId],
      locationId: clockIn.location_id,
      payload: {
        personName: person ? personDisplayName(person as Parameters<typeof personDisplayName>[0]) : "An employee",
        clockInLabel: `${shortDateLabel(clockIn.work_date)} · ${formatClockTime(clockIn.punched_at, WORK_TZ)}`,
        shift: shiftStart ? `${formatShiftTime(shiftStart)}${shiftEnd ? ` – ${formatShiftTime(shiftEnd)}` : ""}` : "",
        locationName: l ? l.display_name || l.name : "",
      },
      dedupeKey: `timeclock.missing_clock_out:${clockIn.id}`,
    });
    if (created.ok && !created.duplicate) {
      await processEvent(created.id);
      produced++;
    }
  }
  return produced;
}

async function produceEscalations(now: Date): Promise<number> {
  const admin = createAdminClient();
  let produced = 0;
  for (const def of EVENT_REGISTRY.values()) {
    if (!def.escalatable || !STILL_OPEN[def.type]) continue;
    const { rule } = await loadRule(def);
    if (!rule.enabled || !rule.escalateAfterHours || !rule.escalateRoles.length) continue;
    const cutoff = new Date(now.getTime() - rule.escalateAfterHours * 3_600_000).toISOString();
    // Never escalate something older than a week — it was handled elsewhere or abandoned.
    const floor = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const { data } = await admin
      .from("notification_event")
      .select("*")
      .eq("event_type", def.type)
      .eq("status", "done")
      .is("escalated_at", null)
      .not("dedupe_key", "like", "escalation:%")
      .lt("created_at", cutoff)
      .gt("created_at", floor)
      .limit(50);
    const events = ((data ?? []) as NotificationEventRow[]).filter((e) => e.payload?._escalation !== true);
    if (!events.length) continue;
    const open = await STILL_OPEN[def.type](admin, events.map((e) => e.subject_id).filter((x): x is string => !!x));
    for (const e of events) {
      // Claim first so two runs can't both escalate it.
      const { data: claimed } = await admin
        .from("notification_event")
        .update({ escalated_at: now.toISOString() })
        .eq("id", e.id)
        .is("escalated_at", null)
        .select("id");
      if (!claimed?.length || !e.subject_id || !open.has(e.subject_id)) continue;
      const created = await createEvent({
        type: e.event_type,
        subjectType: e.subject_type,
        subjectId: e.subject_id,
        subjectPersonIds: e.subject_person_ids,
        locationId: e.location_id,
        payload: { ...e.payload, _escalation: true },
        dedupeKey: `escalation:${e.id}`,
      });
      if (created.ok && !created.duplicate) {
        await processEvent(created.id);
        produced++;
      }
    }
  }
  return produced;
}

function hourInWorkTz(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: WORK_TZ, hour: "numeric", hourCycle: "h23" }).format(now),
  );
}

async function produceEventReminders(now: Date): Promise<number> {
  if (hourInWorkTz(now) < 10) return 0;
  const def = EVENT_REGISTRY.get("marketing.event_upcoming");
  if (!def) return 0;
  const { rule } = await loadRule(def);
  if (!rule.enabled) return 0;

  const admin = createAdminClient();
  const tomorrow = addDays(todayInWorkTz(now), 1);
  const { data } = await admin
    .from("marketing_event")
    .select(MARKETING_EVENT_COLUMNS)
    .eq("starts_on", tomorrow)
    .limit(100);
  let produced = 0;
  for (const row of (data ?? []) as MarketingEventRow[]) {
    if (isCanceled(row.status)) continue;
    const ids = staffIds(row);
    if (!ids.length) continue;
    const { data: people } = await admin
      .from("person")
      .select("id, full_name, first_name, last_name, preferred_name")
      .in("id", ids);
    const names = ((people ?? []) as (Parameters<typeof personDisplayName>[0] & { id: string })[]).map(personDisplayName);
    const created = await createEvent({
      type: "marketing.event_upcoming",
      subjectType: "marketing_event",
      subjectId: row.id,
      subjectPersonIds: ids,
      payload: marketingPayload(row, names),
      dedupeKey: `marketing.event_upcoming:${row.id}:${tomorrow}`,
    });
    if (created.ok && !created.duplicate) {
      await processEvent(created.id);
      produced++;
    }
  }
  return produced;
}
