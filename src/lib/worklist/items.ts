// The per-user work list: item shape, grouping, and the rules for tasks.
// Pure — loaders live in ./sources.ts (server only).

import type { AppUser, ModuleKey } from "../auth/permissions";
import { canEditGeneral } from "../auth/permissions";
import { addDays } from "./dates";

export type WorkPriority = "low" | "normal" | "high" | "urgent";
export const WORK_PRIORITIES: readonly WorkPriority[] = ["low", "normal", "high", "urgent"];

/** Where the user goes to do it. */
export type WorkTarget = "ops" | "slack";

export interface WorkItem {
  /** Stable and unique across sources, e.g. "task:<uuid>", "interview:<uuid>". */
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  module: ModuleKey | null;
  href: string | null;
  target: WorkTarget;
  /** YYYY-MM-DD, or null for "whenever". */
  due: string | null;
  /** Extra time label, e.g. "2:30 PM". */
  dueTime?: string | null;
  priority: WorkPriority;
  /** ops_task rows can be completed/dismissed here; module items are done in their module. */
  taskId?: string;
  /** e.g. "From Slack", "Assigned by Jane". */
  meta?: string | null;
  /** Aggregated queues ("176 candidates to review"). */
  count?: number;
}

export type WorkBucket = "overdue" | "today" | "week" | "later" | "anytime";

export const WORK_BUCKET_LABELS: Record<WorkBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "Next 7 days",
  later: "Later",
  anytime: "No due date",
};

const BUCKET_ORDER: WorkBucket[] = ["overdue", "today", "week", "later", "anytime"];
const PRIORITY_RANK: Record<WorkPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function bucketFor(due: string | null, today: string): WorkBucket {
  if (!due) return "anytime";
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= addDays(today, 7)) return "week";
  return "later";
}

export function compareWorkItems(a: WorkItem, b: WorkItem): number {
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p !== 0) return p;
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  if ((a.dueTime ?? "") !== (b.dueTime ?? "")) return (a.dueTime ?? "~") < (b.dueTime ?? "~") ? -1 : 1;
  return a.title.localeCompare(b.title);
}

export interface WorkGroup {
  bucket: WorkBucket;
  label: string;
  items: WorkItem[];
}

/** Non-empty buckets in display order; duplicate ids are dropped (first wins). */
export function groupWorkItems(items: WorkItem[], today: string): WorkGroup[] {
  const seen = new Set<string>();
  const byBucket = new Map<WorkBucket, WorkItem[]>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const b = bucketFor(item.due, today);
    const list = byBucket.get(b);
    if (list) list.push(item);
    else byBucket.set(b, [item]);
  }
  return BUCKET_ORDER.filter((b) => byBucket.has(b)).map((b) => ({
    bucket: b,
    label: WORK_BUCKET_LABELS[b],
    items: byBucket.get(b)!.sort(compareWorkItems),
  }));
}

export function workSummary(items: WorkItem[], today: string) {
  let overdue = 0;
  let dueToday = 0;
  for (const i of items) {
    const b = bucketFor(i.due, today);
    if (b === "overdue") overdue++;
    else if (b === "today") dueToday++;
  }
  return { total: items.length, overdue, dueToday };
}

/**
 * Links stored on tasks, notifications and reminders: an internal path, or a
 * Slack URL. Mirrors the href CHECK constraints in migration 0230.
 */
export function isSafeWorkLink(href: string | null | undefined): boolean {
  if (href === null || href === undefined || href === "") return true;
  if (/^\/([^/\\]|$)/.test(href)) return true;
  return /^https:\/\/([a-z0-9-]+\.)*slack\.com\//.test(href);
}

export function isSlackLink(href: string | null | undefined): boolean {
  return !!href && /^https:\/\/([a-z0-9-]+\.)*slack\.com\//.test(href);
}

/** Opens Slack (app or browser) at a workspace, optionally a channel/DM. */
export function slackClientUrl(teamId: string | null, channelId?: string | null): string {
  if (!teamId || !/^T[A-Z0-9]+$/.test(teamId)) return "https://app.slack.com/client";
  const channel = channelId && /^[CDG][A-Z0-9]+$/.test(channelId) ? `/${channelId}` : "";
  return `https://app.slack.com/client/${teamId}${channel}`;
}

// ---------------------------------------------------------------------------
// Task rules
// ---------------------------------------------------------------------------

/**
 * Anyone may give themselves a task. Assigning work to someone else needs a
 * role that can edit beyond the Schedule (not Staff).
 */
export function canAssignTaskTo(user: AppUser, assigneeId: string): boolean {
  if (!user.is_active) return false;
  if (assigneeId === user.id) return true;
  return canEditGeneral(user);
}

/** The assignee can close it; so can whoever assigned it. */
export function canChangeTask(
  user: AppUser,
  task: { assignee_user_id: string; created_by_user_id: string | null },
): boolean {
  if (!user.is_active) return false;
  return task.assignee_user_id === user.id || task.created_by_user_id === user.id;
}
