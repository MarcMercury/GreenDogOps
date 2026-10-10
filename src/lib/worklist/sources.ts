import "server-only";

// ---------------------------------------------------------------------------
// Everything the dashboard shows for ONE signed-in user.
//
// Module work is projected from each module's own tables at read time (never
// copied into ops_task), and only for modules the user can access/edit. Each
// source is isolated: one failing query becomes a warning, not a broken home
// page. Every query is filtered to the current user or gated by their role.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import {
  canAccessModule,
  canEditGeneral,
  canEditModule,
  canViewSensitiveHr,
  isAdminRole,
  type AppUser,
  type ModuleKey,
} from "@/lib/auth/permissions";
import { agentHealth, HEALTH_LABELS, needsAttention, type HealthAgent } from "../admin/health";
import { addDays, shortDateLabel, todayInWorkTz, weekdayOf } from "./dates";
import type { WorkItem, WorkPriority } from "./items";
import {
  reminderAppliesTo,
  reminderView,
  type ReminderRule,
  type ReminderView,
} from "./reminders";

type Admin = ReturnType<typeof createAdminClient>;

interface Ctx {
  admin: Admin;
  user: AppUser;
  today: string;
}

type Named = { full_name: string | null; first_name: string | null; last_name: string | null } | null;

/** supabase-js types to-one embeds as arrays; unwrap either shape. */
function one<T>(v: unknown): T | null {
  const x = Array.isArray(v) ? v[0] : v;
  return (x ?? null) as T | null;
}

function personName(p: Named): string {
  if (!p) return "Unknown";
  return p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "Unknown";
}

function timeLabel(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Postgres/PostgREST "table does not exist" — migration 0230 not applied yet. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|could not find the table/i.test(error.message ?? ""));
}

// ---------------------------------------------------------------------------
// Work sources
// ---------------------------------------------------------------------------

interface Source {
  label: string;
  /** Reads a migration-0230 table, so a missing table means "not set up yet". */
  workCenter?: boolean;
  applies: (u: AppUser) => boolean;
  load: (ctx: Ctx) => Promise<WorkItem[]>;
}

const SOURCES: Source[] = [
  {
    label: "your tasks",
    workCenter: true,
    applies: () => true,
    async load({ admin, user }) {
      const { data, error } = await admin
        .from("ops_task")
        .select(
          "id, title, details, priority, due_date, module, href, action_target, source, created_by_user_id, creator:app_user!ops_task_created_by_user_id_fkey (full_name, email)",
        )
        .eq("assignee_user_id", user.id)
        .eq("status", "open")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return (data ?? []).map((r) => {
        const creator = one<{ full_name: string | null; email: string }>(r.creator);
        const fromOther = r.created_by_user_id && r.created_by_user_id !== user.id;
        return {
          id: `task:${r.id}`,
          kind: "task",
          title: r.title,
          detail: r.details,
          module: (r.module as ModuleKey | null) ?? null,
          href: r.href,
          target: r.action_target === "slack" ? "slack" : "ops",
          due: r.due_date,
          priority: r.priority as WorkPriority,
          taskId: r.id,
          meta:
            r.source === "slack"
              ? "From a Slack workflow"
              : fromOther
                ? `Assigned by ${creator?.full_name || creator?.email || "a teammate"}`
                : null,
        } satisfies WorkItem;
      });
    },
  },
  {
    label: "your interviews",
    applies: (u) => canAccessModule(u, "ats"),
    async load({ admin, user, today }) {
      const { data, error } = await admin
        .from("person_interview")
        .select("id, person_id, interview_date, start_time, interview_type, location, person:person_id (full_name, first_name, last_name)")
        .eq("host_user_id", user.id)
        .eq("status", "scheduled")
        .gte("interview_date", addDays(today, -30))
        .lte("interview_date", addDays(today, 14))
        .order("interview_date")
        .limit(50);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return (data ?? []).map((r) => {
        const name = personName(one<Named>(r.person));
        const past = r.interview_date < today;
        return {
          id: `interview:${r.id}`,
          kind: "interview",
          title: past ? `Record interview results: ${name}` : `Interview ${name}`,
          detail: [r.interview_type, r.location].filter(Boolean).join(" · ") || null,
          module: "ats",
          href: `/ats/${r.person_id}`,
          target: "ops",
          due: r.interview_date,
          dueTime: past ? null : timeLabel(r.start_time),
          priority: past ? "high" : "normal",
        } satisfies WorkItem;
      });
    },
  },
  {
    label: "your recruiting tasks",
    applies: (u) => canAccessModule(u, "ats"),
    async load({ admin, user }) {
      const { data, error } = await admin
        .from("recruiting_task")
        .select("id, person_id, title, details, due_date, person:person_id (full_name, first_name, last_name)")
        .eq("created_by", user.id)
        .eq("is_done", false)
        .limit(50);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return (data ?? []).map((r) => ({
        id: `recruiting_task:${r.id}`,
        kind: "recruiting_task",
        title: r.title,
        detail: `Candidate: ${personName(one<Named>(r.person))}`,
        module: "ats",
        href: `/ats/${r.person_id}`,
        target: "ops",
        due: r.due_date,
        priority: "normal",
      }));
    },
  },
  {
    label: "recruiting queues",
    applies: (u) => canEditModule(u, "ats"),
    async load({ admin, user }) {
      const [review, forms, rejections] = await Promise.all([
        admin
          .from("person_recruiting")
          .select("person_id, person!inner (status)", { count: "exact", head: true })
          .eq("review_status", "pending")
          .in("person.status", ["prospect", "applicant"]),
        admin
          .from("recruiting_form_request")
          .select("id", { count: "exact", head: true })
          .eq("status", "completed")
          .is("reviewed_at", null),
        admin
          .from("recruiting_rejection")
          .select("id, person_id, email_scheduled_for, person:person_id (full_name, first_name, last_name)")
          .eq("rejected_by", user.id)
          .eq("email_status", "scheduled")
          .is("undone_at", null)
          .limit(20),
      ]);
      for (const r of [review, forms, rejections]) if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
      const items: WorkItem[] = [];
      if (review.count) {
        items.push({
          id: "queue:ats_review",
          kind: "queue",
          title: `${review.count} candidate${review.count === 1 ? "" : "s"} in the Review Queue`,
          detail: "New applicants waiting to be accepted or declined.",
          module: "ats",
          href: "/ats?tab=review",
          target: "ops",
          due: null,
          priority: "normal",
          count: review.count,
        });
      }
      if (forms.count) {
        items.push({
          id: "queue:ats_forms",
          kind: "queue",
          title: `${forms.count} form response${forms.count === 1 ? "" : "s"} to review`,
          detail: null,
          module: "ats",
          href: "/ats?tab=form_responses",
          target: "ops",
          due: null,
          priority: "normal",
          count: forms.count,
        });
      }
      for (const r of rejections.data ?? []) {
        const when = r.email_scheduled_for ? new Date(r.email_scheduled_for) : null;
        items.push({
          id: `rejection:${r.id}`,
          kind: "rejection",
          title: `Rejection email to ${personName(one<Named>(r.person))} is scheduled`,
          detail: "Cancel it from the Rejected tab if this was a mistake.",
          module: "ats",
          href: "/ats?tab=rejected",
          target: "ops",
          due: when ? todayInWorkTz(when) : null,
          dueTime: when
            ? when.toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" })
            : null,
          priority: "low",
        });
      }
      return items;
    },
  },
  {
    label: "time-off approvals",
    applies: (u) => canEditModule(u, "schedule"),
    async load({ admin, today }) {
      const horizon = addDays(today, 14);
      const { data, error } = await admin
        .from("person_time_off")
        .select("id, kind, start_date, end_date, person:person_id (full_name, first_name, last_name)")
        .eq("status", "requested")
        .gte("end_date", today)
        .order("start_date")
        .limit(500);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      const rows = data ?? [];
      const soon = rows.filter((r) => r.start_date <= horizon);
      const later = rows.length - soon.length;

      const weekStarts = [...new Set(soon.map((r) => addDays(r.start_date, -weekdayOf(r.start_date))))];
      const weekIds = new Map<string, string>();
      if (weekStarts.length) {
        const { data: weeks } = await admin.from("sched_week").select("id, week_start").in("week_start", weekStarts);
        for (const w of weeks ?? []) weekIds.set(w.week_start, w.id);
      }

      const items: WorkItem[] = soon.map((r) => {
        const week = weekIds.get(addDays(r.start_date, -weekdayOf(r.start_date)));
        const range = r.start_date === r.end_date ? shortDateLabel(r.start_date) : `${shortDateLabel(r.start_date)} – ${shortDateLabel(r.end_date)}`;
        return {
          id: `time_off:${r.id}`,
          kind: "time_off_approval",
          title: `Approve or deny time off: ${personName(one<Named>(r.person))}`,
          detail: `${String(r.kind).toUpperCase()} · ${range}`,
          module: "schedule",
          href: week ? `/schedule?week=${week}` : "/schedule",
          target: "ops",
          due: r.start_date < today ? today : r.start_date,
          priority: r.start_date <= addDays(today, 3) ? "high" : "normal",
        };
      });
      if (later > 0) {
        items.push({
          id: "queue:time_off_later",
          kind: "queue",
          title: `${later} more time-off request${later === 1 ? "" : "s"} starting after ${shortDateLabel(horizon)}`,
          detail: null,
          module: "schedule",
          href: "/schedule",
          target: "ops",
          due: null,
          priority: "low",
          count: later,
        });
      }
      return items;
    },
  },
  {
    label: "schedules awaiting approval",
    applies: (u) => canEditModule(u, "schedule"),
    async load({ admin, today }) {
      const { data, error } = await admin
        .from("sched_week")
        .select("id, week_start, title")
        .eq("status", "pending_approval")
        .gte("week_start", addDays(today, -7))
        .order("week_start")
        .limit(10);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return (data ?? []).map((w) => ({
        id: `sched_week:${w.id}`,
        kind: "schedule_approval",
        title: `Approve the schedule for the week of ${shortDateLabel(w.week_start)}`,
        detail: w.title,
        module: "schedule" as const,
        href: `/schedule?week=${w.id}`,
        target: "ops" as const,
        due: w.week_start < today ? today : addDays(w.week_start, -1),
        priority: (w.week_start <= addDays(today, 7) ? "high" : "normal") as WorkPriority,
      }));
    },
  },
  {
    label: "expiring licenses",
    applies: (u) => !!u.person_id || (canViewSensitiveHr(u.role) && canAccessModule(u, "hr")),
    async load({ admin, user, today }) {
      const hrWide = canViewSensitiveHr(user.role) && canAccessModule(user, "hr");
      let q = admin
        .from("person_license")
        .select("id, person_id, name, expiration_date, person!inner (status, full_name, first_name, last_name)")
        .gte("expiration_date", addDays(today, -90))
        .lte("expiration_date", addDays(today, 60))
        .in("person.status", ["employee", "contractor"])
        .order("expiration_date")
        .limit(50);
      if (!hrWide) q = q.eq("person_id", user.person_id!);
      const { data, error } = await q;
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return (data ?? []).map((r) => {
        const mine = r.person_id === user.person_id;
        const expired = r.expiration_date < today;
        const who = mine ? "Your" : `${personName(one<Named>(r.person))}'s`;
        return {
          id: `license:${r.id}`,
          kind: "license",
          title: `${who} ${r.name} ${expired ? "has expired" : "expires soon"}`,
          detail: `Expiration: ${shortDateLabel(r.expiration_date)}`,
          module: "hr" as const,
          href: `/hr/${r.person_id}`,
          target: "ops" as const,
          due: r.expiration_date,
          priority: (expired ? "urgent" : r.expiration_date <= addDays(today, 14) ? "high" : "normal") as WorkPriority,
        };
      });
    },
  },
  {
    label: "scheduled jobs",
    applies: (u) => isAdminRole(u.role),
    async load({ admin, today }) {
      const { data, error } = await admin
        .from("agent")
        .select("id, name, enabled, config, last_run_at, last_status, last_success_at, last_error, consecutive_failures")
        .eq("enabled", true);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      const now = new Date();
      return ((data ?? []) as (HealthAgent & { id: string; name: string })[]).flatMap((a) => {
        const health = agentHealth(a, null, now);
        if (!needsAttention(a, health)) return [];
        return [
          {
            id: `agent_health:${a.id}`,
            kind: "job_health",
            title: `${a.name} is ${HEALTH_LABELS[health.state].toLowerCase()}`,
            detail: health.summary,
            module: "admin" as const,
            href: "/admin/agents",
            target: "ops" as const,
            due: today,
            priority: (health.state === "stale" ? "high" : "urgent") as WorkPriority,
          },
        ];
      });
    },
  },
];

// ---------------------------------------------------------------------------
// Dashboard bundle
// ---------------------------------------------------------------------------

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  module: string | null;
  severity: "info" | "action" | "warning";
  read_at: string | null;
  created_at: string;
}

export interface SlackDeliveryRow {
  id: string;
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  created_at: string;
  sent_at: string | null;
  last_error: string | null;
  slack_channel_id: string | null;
  title: string;
}

export interface AssignedByMeRow {
  id: string;
  title: string;
  due_date: string | null;
  assignee: string;
}

export interface DashboardData {
  today: string;
  /** Migration 0230 isn't applied: tasks/notifications/reminders are unavailable. */
  setupNeeded: boolean;
  work: WorkItem[];
  warnings: string[];
  assignedByMe: AssignedByMeRow[];
  reminders: { current: ReminderView[]; upcoming: { view: ReminderView; date: string }[] };
  notifications: { items: NotificationRow[]; unread: number };
  slack: {
    link: { status: string; slack_user_id: string | null; slack_team_id: string | null } | null;
    deliveries: SlackDeliveryRow[];
  };
  /** People this user may assign tasks to (empty = only themselves). */
  assignees: { id: string; name: string }[];
}

async function loadReminders(ctx: Ctx): Promise<DashboardData["reminders"]> {
  const { admin, user, today } = ctx;
  const [{ data: rules, error }, { data: acks, error: ackError }] = await Promise.all([
    admin
      .from("reminder_rule")
      .select("*")
      .eq("is_active", true)
      .or(`owner_user_id.is.null,owner_user_id.eq.${user.id}`)
      .order("sort_order")
      .limit(300),
    admin
      .from("reminder_ack")
      .select("rule_id, occurrence_date")
      .eq("user_id", user.id)
      .gte("occurrence_date", addDays(today, -400))
      .limit(5000),
  ]);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  if (ackError) throw new Error(ackError.message);

  const acked = new Map<string, Set<string>>();
  for (const a of acks ?? []) {
    const set = acked.get(a.rule_id) ?? new Set<string>();
    set.add(a.occurrence_date);
    acked.set(a.rule_id, set);
  }

  const current: ReminderView[] = [];
  const upcoming: { view: ReminderView; date: string }[] = [];
  const weekOut = addDays(today, 7);
  for (const r of (rules ?? []) as ReminderRule[]) {
    if (!reminderAppliesTo(r, user)) continue;
    const view = reminderView(r, today, acked.get(r.id) ?? new Set());
    if (view.status === "due" || view.status === "overdue" || (view.status === "done" && view.occurrence === today)) {
      current.push(view);
    }
    if (view.next && view.next <= weekOut) upcoming.push({ view, date: view.next });
  }
  const rank = { overdue: 0, due: 1, done: 2 } as const;
  current.sort((a, b) => rank[a.status!] - rank[b.status!] || a.rule.sort_order - b.rule.sort_order);
  upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.view.rule.sort_order - b.view.rule.sort_order));
  return { current, upcoming };
}

export async function loadDashboard(user: AppUser): Promise<DashboardData> {
  const admin = createAdminClient();
  const today = todayInWorkTz();
  const ctx: Ctx = { admin, user, today };
  const warnings: string[] = [];
  let setupNeeded = false;

  const noteError = (label: string, err: unknown, workCenter = true) => {
    const e = err as { code?: string; message?: string };
    if (workCenter && isMissingTable(e)) {
      setupNeeded = true;
      return;
    }
    warnings.push(`Couldn't load ${label}: ${e?.message ?? String(err)}`);
  };

  const workPromise = Promise.all(
    SOURCES.filter((s) => s.applies(user)).map((s) =>
      s.load(ctx).catch((err) => {
        noteError(s.label, err, !!s.workCenter);
        return [] as WorkItem[];
      }),
    ),
  ).then((lists) => lists.flat());

  const remindersPromise = loadReminders(ctx).catch((err) => {
    noteError("reminders", err);
    return { current: [], upcoming: [] };
  });

  const notificationsPromise = (async () => {
    const [list, unread] = await Promise.all([
      admin
        .from("user_notification")
        .select("id, kind, title, body, href, module, severity, read_at, created_at")
        .eq("recipient_user_id", user.id)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(30),
      admin
        .from("user_notification")
        .select("id", { count: "exact", head: true })
        .eq("recipient_user_id", user.id)
        .is("archived_at", null)
        .is("read_at", null),
    ]);
    if (list.error) throw Object.assign(new Error(list.error.message), { code: list.error.code });
    return { items: (list.data ?? []) as NotificationRow[], unread: unread.count ?? 0 };
  })().catch((err) => {
    noteError("notifications", err);
    return { items: [], unread: 0 };
  });

  const slackPromise = (async () => {
    const [linkRes, deliveries] = await Promise.all([
      user.person_id
        ? admin
            .from("person_slack_link")
            .select("status, slack_user_id, slack_team_id")
            .eq("person_id", user.person_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin
        .from("notification_delivery")
        .select("id, status, created_at, sent_at, last_error, slack_channel_id, notification:notification_id!inner (title, recipient_user_id)")
        .eq("notification.recipient_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (deliveries.error) noteError("Slack activity", deliveries.error);
    return {
      link: (linkRes.data as DashboardData["slack"]["link"]) ?? null,
      deliveries: (deliveries.error ? [] : (deliveries.data ?? [])).map((d) => ({
        id: d.id,
        status: d.status,
        created_at: d.created_at,
        sent_at: d.sent_at,
        last_error: d.last_error,
        slack_channel_id: d.slack_channel_id,
        title: one<{ title: string }>(d.notification)?.title ?? "",
      })) as SlackDeliveryRow[],
    };
  })().catch((err) => {
    noteError("Slack activity", err);
    return { link: null, deliveries: [] };
  });

  const assignedPromise = admin
    .from("ops_task")
    .select("id, title, due_date, assignee:app_user!ops_task_assignee_user_id_fkey (full_name, email)")
    .eq("created_by_user_id", user.id)
    .neq("assignee_user_id", user.id)
    .eq("status", "open")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(25)
    .then(({ data, error }) => {
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return (data ?? []).map((r) => {
        const a = one<{ full_name: string | null; email: string }>(r.assignee);
        return { id: r.id, title: r.title, due_date: r.due_date, assignee: a?.full_name || a?.email || "—" };
      });
    })
    .then(
      (rows) => rows,
      (err: unknown) => {
        noteError("tasks you assigned", err);
        return [] as AssignedByMeRow[];
      },
    );

  const assigneesPromise = canEditGeneral(user)
    ? admin
        .from("app_user")
        .select("id, full_name, email")
        .eq("is_active", true)
        .order("full_name")
        .limit(500)
        .then(({ data }) => (data ?? []).map((u) => ({ id: u.id as string, name: (u.full_name as string | null) || (u.email as string) })))
    : Promise.resolve([] as { id: string; name: string }[]);

  const [work, reminders, notifications, slack, assignedByMe, assignees] = await Promise.all([
    workPromise,
    remindersPromise,
    notificationsPromise,
    slackPromise,
    assignedPromise,
    assigneesPromise,
  ]);

  return { today, setupNeeded, work, warnings, assignedByMe, reminders, notifications, slack, assignees };
}
