// Fan-out planning: turn one event + its effective rule + resolved recipients
// into the inbox rows and Slack deliveries to write. Pure; engine.ts writes them.

import type { EventDefinition, NotifySeverity } from "./registry";
import type { StoredCard } from "./slack-blocks";
import type {
  NotifyActionId,
  NotifyPriority,
  RenderedMessage,
  ResolvedRecipient,
  RuleConfig,
} from "./types";

export interface PlanEvent {
  id: string;
  type: string;
  subjectId: string | null;
  payload: Record<string, unknown>;
}

export interface PlannedInbox {
  userId: string;
  title: string;
  body: string | null;
  href: string | null;
  severity: NotifySeverity;
  dedupeKey: string;
}

export interface PlannedDelivery {
  channel: "slack_dm" | "slack_channel";
  personId: string | null;
  userId: string | null;
  slackUserId: string | null;
  slackChannelId: string | null;
  status: "pending" | "skipped";
  lastError: string | null;
  title: string;
  body: string | null;
  href: string | null;
  card: StoredCard;
  requiredModule: string | null;
  audienceReason: string;
  priority: NotifyPriority;
  coalesceKey: string | null;
  messageKey: string | null;
  batched: boolean;
  sendAt: Date;
}

export interface PlannedRecipient {
  recipient: ResolvedRecipient;
  inbox: PlannedInbox | null;
  dm: PlannedDelivery | null;
}

export interface FanoutPlan {
  recipients: PlannedRecipient[];
  channel: PlannedDelivery | null;
}

const APP_PATH = /^\/([^/\\]|$)/;

/** Body + fields + lines as plain text (inbox, delivery log). */
export function plainText(msg: RenderedMessage, max = 2000): string | null {
  const parts: string[] = [];
  if (msg.body?.trim()) parts.push(msg.body.trim());
  for (const f of msg.fields ?? []) if (f.value.trim()) parts.push(`${f.label}: ${f.value.trim()}`);
  for (const l of msg.lines ?? []) if (l.trim()) parts.push(`• ${l.trim()}`);
  const text = parts.join("\n");
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function clipTitle(title: string): string {
  const t = title.trim();
  return t.length <= 200 ? t : `${t.slice(0, 199)}…`;
}

/** Buttons a recipient may see on this event. */
export function actionsFor(def: EventDefinition, r: { isSubject: boolean; canAct: boolean } | "channel"): NotifyActionId[] {
  return (def.actions ?? []).filter((a) => {
    if (a === "pto.approve" || a === "pto.deny") return r === "channel" || r.canAct;
    if (a === "task.complete") return r !== "channel" && r.isSubject;
    return true;
  });
}

export function planFanout(input: {
  def: EventDefinition;
  rule: RuleConfig;
  event: PlanEvent;
  recipients: ResolvedRecipient[];
  now: Date;
  /** An escalation of an earlier event: re-labelled, never batched. */
  escalation?: boolean;
}): FanoutPlan {
  const { def, rule, event, now } = input;
  const render = def.render;
  if (!render) return { recipients: [], channel: null };
  const batched = !input.escalation && rule.batchMinutes > 0;
  const sendAt = batched ? new Date(now.getTime() + rule.batchMinutes * 60_000) : now;
  const messageKey = def.messageKey?.(event.subjectId) ?? null;
  const relabel = (msg: RenderedMessage): RenderedMessage =>
    input.escalation ? { ...msg, emoji: "⏰", title: `Still waiting: ${msg.title}` } : msg;

  const planned: PlannedRecipient[] = [];
  for (const r of input.recipients) {
    const msg = relabel(
      render(event.payload, {
        isSubject: r.isSubject,
        personId: r.personId,
        isChannel: false,
        moduleAccess: r.moduleAccess,
      }),
    );
    const restricted =
      !r.isSubject && (def.sensitivity === "module" || (!!def.detailsNeedModule && r.moduleAccess));
    // Someone without a login can't open an app link.
    const href = msg.href && APP_PATH.test(msg.href) && !r.userId ? null : (msg.href ?? null);
    const shown: RenderedMessage = { ...msg, href };
    const title = clipTitle(`${msg.emoji ? `${msg.emoji} ` : ""}${msg.title}`);

    const inbox: PlannedInbox | null =
      rule.deliverInbox && r.userId
        ? {
            userId: r.userId,
            title,
            body: plainText(shown),
            href,
            severity: def.severity,
            dedupeKey: input.escalation ? `${event.id}:escalation` : event.id,
          }
        : null;

    let dm: PlannedDelivery | null = null;
    if (rule.deliverDm) {
      dm = {
        channel: "slack_dm",
        personId: r.personId,
        userId: r.userId,
        slackUserId: r.slackUserId,
        slackChannelId: null,
        status: r.slackUserId ? "pending" : "skipped",
        lastError: r.slackUserId ? null : "No connected Slack account (Admin ▸ Slack).",
        title: clipTitle(msg.title),
        body: plainText(shown, 3000),
        href,
        card: { msg: shown, actions: actionsFor(def, r) },
        requiredModule: restricted ? def.module : null,
        audienceReason: (input.escalation ? ["escalation", ...r.reasons] : r.reasons).join(","),
        priority: rule.priority,
        coalesceKey: batched ? (def.coalesceKey?.(event.payload) ?? null) : null,
        messageKey,
        batched,
        sendAt,
      };
    }
    planned.push({ recipient: r, inbox, dm });
  }

  let channel: PlannedDelivery | null = null;
  if (rule.channelId && def.allowChannel) {
    const msg = relabel(render(event.payload, { isSubject: false, personId: null, isChannel: true, moduleAccess: false }));
    channel = {
      channel: "slack_channel",
      personId: null,
      userId: null,
      slackUserId: null,
      slackChannelId: rule.channelId,
      status: "pending",
      lastError: null,
      title: clipTitle(msg.title),
      body: plainText(msg, 3000),
      href: msg.href ?? null,
      card: { msg, actions: actionsFor(def, "channel") },
      requiredModule: null,
      audienceReason: input.escalation ? "escalation,channel" : "channel",
      priority: rule.priority,
      coalesceKey: null,
      messageKey,
      batched: false,
      sendAt: now,
    };
  }
  return { recipients: planned, channel };
}
