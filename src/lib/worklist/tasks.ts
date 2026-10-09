import "server-only";

// ---------------------------------------------------------------------------
// ops_task writes. Every path — the dashboard's Server Actions and the
// inbound Slack-workflow endpoint — goes through here, so permissions,
// notifications, audit and workflow events stay consistent.
// ---------------------------------------------------------------------------

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit, type CurrentUser } from "@/lib/auth/session";
import { publishNotification } from "@/lib/notify/publish";
import { emitSlackWorkflowEvent, slackWorkflowConfigured, type SlackWorkflowEvent } from "@/lib/notify/slack-workflow";
import { appBaseUrl } from "@/lib/shared/app-url";
import { canAssignTaskTo, canChangeTask, isSafeWorkLink, isSlackLink, type WorkPriority } from "./items";
import { inboundTaskRow, type InboundTask } from "./inbound";

export interface OpsTaskRow {
  id: string;
  title: string;
  details: string | null;
  assignee_user_id: string;
  created_by_user_id: string | null;
  status: "open" | "done" | "dismissed";
  priority: WorkPriority;
  due_date: string | null;
  module: string | null;
  href: string | null;
  action_target: "ops" | "slack";
  source: "ops" | "slack" | "system";
  external_ref: string | null;
  created_at: string;
  completed_at: string | null;
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

interface Login {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  person_id: string | null;
}

async function loadLogin(id: string): Promise<Login | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_user")
    .select("id, email, full_name, is_active, person_id")
    .eq("id", id)
    .maybeSingle();
  return (data as Login | null) ?? null;
}

function displayName(u: Pick<Login, "full_name" | "email"> | null): string {
  return u?.full_name?.trim() || u?.email || "Someone";
}

function emitLater(event: SlackWorkflowEvent, task: OpsTaskRow, assignee: Login | null, actorName: string) {
  if (!slackWorkflowConfigured()) return;
  const run = async () => {
    const href = task.href ?? "/";
    const res = await emitSlackWorkflowEvent(event, {
      task_id: task.id,
      title: task.title,
      details: task.details,
      due_date: task.due_date,
      priority: task.priority,
      assignee_name: displayName(assignee),
      assignee_email: assignee?.email,
      actor_name: actorName,
      source: task.source,
      external_ref: task.external_ref,
      link: href.startsWith("/") ? `${appBaseUrl()}${href}` : href,
    });
    if (!res.ok) console.error(`[slack-workflow] ${event} for task ${task.id}: ${res.error}`);
  };
  try {
    after(run);
  } catch {
    // Outside a request (scripts): send inline.
    void run();
  }
}

export interface NewTaskInput {
  assigneeUserId: string;
  title: string;
  details: string | null;
  dueDate: string | null;
  priority: WorkPriority;
  href: string | null;
  module?: string | null;
  /** DM the assignee in Slack too (only when assigning to someone else). */
  notifySlack: boolean;
}

export async function createOpsTask(actor: CurrentUser, input: NewTaskInput): Promise<Result<{ id: string }>> {
  if (!canAssignTaskTo(actor.appUser, input.assigneeUserId)) {
    return { ok: false, error: "You can only add tasks for yourself." };
  }
  if (!isSafeWorkLink(input.href)) return { ok: false, error: "Link must be an app path or a Slack URL." };

  const assignee = await loadLogin(input.assigneeUserId);
  if (!assignee?.is_active) return { ok: false, error: "That person doesn't have an active Ops login." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ops_task")
    .insert({
      title: input.title,
      details: input.details,
      assignee_user_id: assignee.id,
      created_by_user_id: actor.appUser.id,
      priority: input.priority,
      due_date: input.dueDate,
      module: input.module ?? null,
      href: input.href,
      action_target: isSlackLink(input.href) ? "slack" : "ops",
      source: "ops",
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  const task = data as OpsTaskRow;
  const actorName = displayName(actor.appUser);
  const forSomeoneElse = assignee.id !== actor.appUser.id;

  await recordAudit({
    actorId: actor.authId,
    actorEmail: actor.email,
    action: "task.create",
    entity: "ops_task",
    entityId: task.id,
    summary: forSomeoneElse ? `Assigned "${task.title}" to ${displayName(assignee)}` : `Added task "${task.title}"`,
  });

  if (forSomeoneElse) {
    await publishNotification({
      recipientUserId: assignee.id,
      kind: "task.assigned",
      title: `${actorName} assigned you: ${task.title}`,
      body: task.due_date ? `Due ${task.due_date}` : null,
      href: "/",
      severity: "action",
      actorUserId: actor.appUser.id,
      taskId: task.id,
      dedupeKey: `task.assigned:${task.id}`,
      slack: input.notifySlack,
    });
  }
  emitLater("task.created", task, assignee, actorName);
  return { ok: true, id: task.id };
}

export async function setOpsTaskStatus(
  actor: CurrentUser,
  taskId: string,
  status: "open" | "done" | "dismissed",
): Promise<Result> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("ops_task").select("*").eq("id", taskId).maybeSingle();
  const task = existing as OpsTaskRow | null;
  if (!task || !canChangeTask(actor.appUser, task)) return { ok: false, error: "Task not found." };
  if (task.status === status) return { ok: true };

  const closing = status !== "open";
  const { error } = await admin
    .from("ops_task")
    .update({
      status,
      completed_at: closing ? new Date().toISOString() : null,
      completed_by_user_id: closing ? actor.appUser.id : null,
    })
    .eq("id", taskId);
  if (error) return { ok: false, error: error.message };

  await recordAudit({
    actorId: actor.authId,
    actorEmail: actor.email,
    action: `task.${status === "open" ? "reopen" : status === "done" ? "complete" : "dismiss"}`,
    entity: "ops_task",
    entityId: taskId,
    summary: `${status === "open" ? "Reopened" : status === "done" ? "Completed" : "Dismissed"} "${task.title}"`,
  });

  const actorName = displayName(actor.appUser);
  if (closing && task.created_by_user_id && task.created_by_user_id !== actor.appUser.id) {
    await publishNotification({
      recipientUserId: task.created_by_user_id,
      kind: status === "done" ? "task.completed" : "task.dismissed",
      title: `${actorName} ${status === "done" ? "completed" : "dismissed"}: ${task.title}`,
      href: "/",
      actorUserId: actor.appUser.id,
      taskId,
      dedupeKey: `task.${status}:${taskId}:${new Date().toISOString().slice(0, 13)}`,
    });
  }
  if (closing) {
    const assignee = await loadLogin(task.assignee_user_id);
    emitLater(status === "done" ? "task.completed" : "task.dismissed", { ...task, status }, assignee, actorName);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Inbound (Slack workflow → Ops)
// ---------------------------------------------------------------------------

/** The active Ops login for a Slack user id (connected link) or an email. */
export async function resolveInboundAssignee(task: InboundTask): Promise<Login | null> {
  const admin = createAdminClient();
  if (task.assignee_slack_user_id) {
    const { data: link } = await admin
      .from("person_slack_link")
      .select("person_id")
      .eq("slack_user_id", task.assignee_slack_user_id)
      .eq("status", "connected")
      .maybeSingle();
    const personId = (link as { person_id: string } | null)?.person_id;
    if (personId) {
      const { data } = await admin
        .from("app_user")
        .select("id, email, full_name, is_active, person_id")
        .eq("person_id", personId)
        .eq("is_active", true)
        .limit(1);
      const login = (data as Login[] | null)?.[0];
      if (login) return login;
    }
  }
  if (task.assignee_email) {
    const { data } = await admin
      .from("app_user")
      .select("id, email, full_name, is_active, person_id")
      .ilike("email", task.assignee_email.replace(/[\\%_]/g, (c) => `\\${c}`))
      .eq("is_active", true)
      .limit(2);
    const rows = (data as Login[] | null) ?? [];
    if (rows.length === 1) return rows[0];
  }
  return null;
}

export async function createInboundTask(
  task: InboundTask,
): Promise<Result<{ id: string; duplicate: boolean }> & { status?: number }> {
  const assignee = await resolveInboundAssignee(task);
  if (!assignee) {
    return {
      ok: false,
      status: 422,
      error: "No active Ops login for that assignee (Slack account must be connected in Admin ▸ Slack, or the email must match a login).",
    };
  }

  const admin = createAdminClient();
  const row = inboundTaskRow(task);
  const { data, error } = await admin
    .from("ops_task")
    .insert({ ...row, assignee_user_id: assignee.id })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await admin
        .from("ops_task")
        .select("id")
        .eq("source", "slack")
        .eq("external_ref", row.external_ref)
        .maybeSingle();
      return { ok: true, id: (existing as { id: string } | null)?.id ?? "", duplicate: true };
    }
    return { ok: false, status: 500, error: error.message };
  }

  const created = data as OpsTaskRow;
  await recordAudit({
    actorId: null,
    actorEmail: "system:slack-workflow",
    action: "task.create",
    entity: "ops_task",
    entityId: created.id,
    summary: `Slack workflow assigned "${created.title}" to ${displayName(assignee)}`,
    metadata: { external_ref: created.external_ref, slack_user_id: row.slack_user_id },
  });
  await publishNotification({
    recipientUserId: assignee.id,
    kind: "task.assigned",
    title: `New task from Slack: ${created.title}`,
    body: created.due_date ? `Due ${created.due_date}` : null,
    href: "/",
    severity: "action",
    taskId: created.id,
    dedupeKey: `task.assigned:${created.id}`,
  });
  return { ok: true, id: created.id, duplicate: false };
}
