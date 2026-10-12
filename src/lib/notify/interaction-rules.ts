// Pure rules for Slack button clicks on Ops notifications: parsing the
// interaction payload and deciding whether the clicker may do the action.

import { canEditModule, type AppUser } from "../auth/permissions";
import { ACTION_PREFIX, isNotifyActionId } from "./slack-blocks";
import type { NotifyActionId } from "./types";

export interface ParsedInteraction {
  slackUserId: string;
  actionId: NotifyActionId | "link";
  deliveryId: string | null;
  actionTs: string;
  responseUrl: string | null;
}

const SLACK_USER = /^[UW][A-Z0-9]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESPONSE_URL = /^https:\/\/hooks\.slack\.com\//;

export function parseInteraction(payload: unknown): ParsedInteraction | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as {
    type?: string;
    user?: { id?: string };
    actions?: { action_id?: string; value?: string; action_ts?: string }[];
    response_url?: string;
  };
  if (p.type !== "block_actions") return null;
  const slackUserId = p.user?.id ?? "";
  if (!SLACK_USER.test(slackUserId)) return null;
  const action = p.actions?.[0];
  const raw = action?.action_id ?? "";
  if (!raw.startsWith(ACTION_PREFIX)) return null;
  const id = raw.slice(ACTION_PREFIX.length);
  if (id !== "link" && !isNotifyActionId(id)) return null;
  const deliveryId = action?.value && UUID.test(action.value) ? action.value : null;
  if (id !== "link" && !deliveryId) return null;
  return {
    slackUserId,
    actionId: id as NotifyActionId | "link",
    deliveryId,
    actionTs: action?.action_ts ?? "",
    responseUrl: p.response_url && RESPONSE_URL.test(p.response_url) ? p.response_url : null,
  };
}

export interface ActionDelivery {
  channel: "slack_dm" | "slack_channel";
  slack_user_id: string | null;
}

export type ActionDecision = { ok: true } | { ok: false; reason: string };

/**
 * May this Slack user take `action` on this delivery?
 *  - A DM's buttons only work for the person it was sent to.
 *  - Approve / deny needs an active Ops login that can edit Scheduling.
 *  - Completing a task needs an Ops login (the task layer checks ownership).
 *  - Acknowledge only needs to be the recipient (or a channel member).
 */
export function authorizeAction(input: {
  action: NotifyActionId;
  delivery: ActionDelivery;
  clickerSlackId: string;
  login: AppUser | null;
}): ActionDecision {
  if (input.delivery.channel === "slack_dm" && input.delivery.slack_user_id !== input.clickerSlackId) {
    return { ok: false, reason: "This message was sent to someone else." };
  }
  switch (input.action) {
    case "pto.approve":
    case "pto.deny":
      if (!input.login) return { ok: false, reason: "You need a Green Dog Ops login to approve time off." };
      if (!canEditModule(input.login, "schedule")) {
        return { ok: false, reason: "Your Ops role can't approve time off." };
      }
      return { ok: true };
    case "task.complete":
      if (!input.login) return { ok: false, reason: "You need a Green Dog Ops login to complete tasks." };
      return { ok: true };
    case "ack":
      return { ok: true };
  }
}
