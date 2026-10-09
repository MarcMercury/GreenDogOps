// Contract for tasks created from outside Ops (Slack workflows today) via
// POST /api/tasks/inbound. Pure — the route resolves the assignee and writes.

import { z } from "zod";
import { isSafeWorkLink, isSlackLink, WORK_PRIORITIES, type WorkPriority } from "./items";
import { isIsoDate } from "./dates";

const SLACK_USER = /^[UW][A-Z0-9]+$/;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const inboundTaskSchema = z
  .object({
    /** The workflow's own id for this request — repeats are ignored (idempotent). */
    external_id: z.string().trim().min(1).max(200),
    assignee_slack_user_id: z.preprocess(blank, z.string().trim().regex(SLACK_USER).optional()),
    assignee_email: z.preprocess(blank, z.string().trim().toLowerCase().email().max(254).optional()),
    title: z.string().trim().min(1).max(200),
    details: z.preprocess(blank, z.string().trim().max(4000).optional()),
    due_date: z.preprocess(blank, z.string().refine(isIsoDate, "Use a YYYY-MM-DD date.").optional()),
    priority: z.preprocess(
      blank,
      z.enum(WORK_PRIORITIES as unknown as [WorkPriority, ...WorkPriority[]]).optional(),
    ),
    /** App path ("/ats/…") or a slack.com URL (e.g. the message permalink). */
    link: z.preprocess(
      blank,
      z.string().trim().max(1000).refine(isSafeWorkLink, "Link must be an app path or a slack.com URL.").optional(),
    ),
    created_by_slack_user_id: z.preprocess(blank, z.string().trim().regex(SLACK_USER).optional()),
  })
  .refine((v) => v.assignee_slack_user_id || v.assignee_email, {
    message: "Give assignee_slack_user_id or assignee_email.",
    path: ["assignee_slack_user_id"],
  });

export type InboundTask = z.infer<typeof inboundTaskSchema>;

export type InboundParse = { ok: true; task: InboundTask } | { ok: false; error: string };

export function parseInboundTask(body: unknown): InboundParse {
  const parsed = inboundTaskSchema.safeParse(body);
  if (parsed.success) return { ok: true, task: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue.path.join(".");
  return { ok: false, error: field ? `${field}: ${issue.message}` : issue.message };
}

/** Column values for ops_task, apart from the resolved assignee. */
export function inboundTaskRow(task: InboundTask) {
  return {
    title: task.title,
    details: task.details ?? null,
    due_date: task.due_date ?? null,
    priority: task.priority ?? "normal",
    href: task.link ?? null,
    action_target: isSlackLink(task.link) ? "slack" : "ops",
    source: "slack" as const,
    external_ref: task.external_id,
    slack_user_id: task.created_by_slack_user_id ?? null,
  };
}
