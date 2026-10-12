// Shared types for the notification engine. Pure — safe to import anywhere.

import type { AppRole, ModuleKey } from "../auth/permissions";

export type NotifyPriority = "low" | "normal" | "high" | "urgent";
export const NOTIFY_PRIORITIES: NotifyPriority[] = ["low", "normal", "high", "urgent"];

/** Who receives an event. Every part is optional and results are combined (union). */
export interface Audience {
  /** The people the event is about (the employee whose shift changed, the requester…). */
  subjects: boolean;
  /** Ops logins with any of these roles. */
  roles: AppRole[];
  /** Ops logins who can EDIT any of these modules (role defaults + per-user overrides). */
  editorsOf: ModuleKey[];
  /** Specific people. */
  personIds: string[];
  /** Everyone in these scheduling departments (via their scheduling roles). */
  departmentIds: string[];
  /** Staff the event lists as candidates (e.g. eligible to cover an open shift). */
  candidates: boolean;
  /**
   * Restrict role / editor / department recipients to people whose home
   * location is the event's location (when the event has one).
   */
  sameLocation: boolean;
  /** Never notify the person who caused the event. */
  excludeActor: boolean;
}

export const EMPTY_AUDIENCE: Audience = {
  subjects: false,
  roles: [],
  editorsOf: [],
  personIds: [],
  departmentIds: [],
  candidates: false,
  sameLocation: false,
  excludeActor: true,
};

/** Effective routing for one event type: the code default, or an admin override. */
export interface RuleConfig {
  enabled: boolean;
  audience: Audience;
  deliverDm: boolean;
  deliverInbox: boolean;
  /** Slack channel to also post to (id). Only for event types that allow channel posts. */
  channelId: string | null;
  channelName: string | null;
  priority: NotifyPriority;
  /** Hold DMs this long and send them as one digest (0 = send right away). */
  batchMinutes: number;
  /** Re-notify when an action-required event is still open after this many hours. */
  escalateAfterHours: number | null;
  escalateRoles: AppRole[];
}

/**
 * How sensitive an event's content is.
 *   general — fine for any employee who is in the audience.
 *   module  — only the subject, or Ops logins who can open `module`.
 */
export type Sensitivity = "general" | "module";

/** Slack buttons an event can carry (handled by /api/slack/interactions). */
export type NotifyActionId = "pto.approve" | "pto.deny" | "ack" | "task.complete";

export interface RenderField {
  label: string;
  value: string;
}

/** What a recipient sees. Plain text — Slack escaping happens in slack-blocks.ts. */
export interface RenderedMessage {
  title: string;
  /** Optional emoji shown before the title in Slack. */
  emoji?: string;
  body?: string | null;
  fields?: RenderField[];
  /** Bulleted lines (e.g. a person's shifts). */
  lines?: string[];
  /** App path ("/schedule") or slack.com URL. */
  href?: string | null;
  /** Label for the link button. */
  linkLabel?: string;
}

export interface RenderContext {
  /** The recipient is one of the event's subjects. */
  isSubject: boolean;
  /** Recipient person id (null for channel posts). */
  personId: string | null;
  /** True for a channel post (keep it to what the whole channel may see). */
  isChannel: boolean;
  /** The recipient can open the event's module in Ops (false for channels). */
  moduleAccess?: boolean;
}

/** A person-level recipient after audience resolution and permission checks. */
export interface ResolvedRecipient {
  personId: string;
  userId: string | null;
  slackUserId: string | null;
  isSubject: boolean;
  /** Why they were included, e.g. ["subject"], ["role:schedule_admin"]. */
  reasons: string[];
  /** May use the event's action buttons (e.g. approve PTO). */
  canAct: boolean;
  /** Their Ops login can open the event's module right now. */
  moduleAccess: boolean;
}

export interface ExcludedRecipient {
  personId: string;
  name: string;
  reason: string;
}
