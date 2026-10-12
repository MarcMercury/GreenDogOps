// Slack Block Kit for Ops notifications. Pure.
//
// A delivery stores its rendered message + allowed buttons (StoredCard) and
// the blocks are built at send time, so the delivery id can ride on each
// button and a sent card can be rebuilt later (resolved, buttons removed).

import { slackEscape } from "./rules";
import type { NotifyActionId, RenderedMessage } from "./types";

export interface StoredCard {
  msg: RenderedMessage;
  actions: NotifyActionId[];
}

export type SlackBlock = Record<string, unknown>;

export const ACTION_PREFIX = "gdo:";
const MAX_SECTION = 2900;

const ACTION_BUTTONS: Record<NotifyActionId, { text: string; style?: "primary" | "danger"; confirm?: string }> = {
  "pto.approve": { text: "Approve", style: "primary" },
  "pto.deny": { text: "Deny", style: "danger", confirm: "Deny this time-off request?" },
  ack: { text: "Acknowledge" },
  "task.complete": { text: "Mark complete", style: "primary" },
};

export function isNotifyActionId(v: string): v is NotifyActionId {
  return v in ACTION_BUTTONS;
}

function clipText(text: string, max = MAX_SECTION): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Absolute URL for an app path, or the slack.com URL as-is. */
export function absoluteUrl(href: string, baseUrl: string): string {
  return href.startsWith("/") ? `${baseUrl}${href}` : href;
}

/** Plain-text fallback (notification preview / screen readers). */
export function fallbackText(msg: RenderedMessage): string {
  const head = `${msg.emoji ? `${msg.emoji} ` : ""}${msg.title}`;
  return clipText([head, msg.body?.trim()].filter(Boolean).join(" — "), 300);
}

function messageSections(msg: RenderedMessage): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  const head = `${msg.emoji ? `${msg.emoji} ` : ""}*${slackEscape(msg.title)}*`;
  const body = msg.body?.trim() ? `\n${slackEscape(msg.body.trim())}` : "";
  blocks.push({ type: "section", text: { type: "mrkdwn", text: clipText(head + body) } });

  const fields = (msg.fields ?? []).filter((f) => f.value.trim()).slice(0, 10);
  if (fields.length) {
    blocks.push({
      type: "section",
      fields: fields.map((f) => ({
        type: "mrkdwn",
        text: clipText(`*${slackEscape(f.label)}*\n${slackEscape(f.value)}`, 1900),
      })),
    });
  }
  const lines = (msg.lines ?? []).filter((l) => l.trim());
  if (lines.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: clipText(lines.map((l) => `• ${slackEscape(l)}`).join("\n")) },
    });
  }
  return blocks;
}

export interface CardOptions {
  baseUrl: string;
  deliveryId: string;
  /** Show the action buttons (false once resolved, or when the recipient may not act). */
  showActions: boolean;
  /** Shown under the card once the record is resolved, e.g. "✅ Approved by Jane". */
  resolvedNote?: string | null;
}

/** One notification card. */
export function buildCardBlocks(card: StoredCard, opts: CardOptions): SlackBlock[] {
  const blocks = messageSections(card.msg);
  const elements: SlackBlock[] = [];
  if (card.msg.href) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: card.msg.linkLabel || "View in GDD Ops" },
      url: absoluteUrl(card.msg.href, opts.baseUrl),
      action_id: `${ACTION_PREFIX}link`,
    });
  }
  if (opts.showActions && !opts.resolvedNote) {
    for (const id of card.actions) {
      const b = ACTION_BUTTONS[id];
      const button: SlackBlock = {
        type: "button",
        text: { type: "plain_text", text: b.text },
        action_id: `${ACTION_PREFIX}${id}`,
        value: opts.deliveryId,
      };
      if (b.style) button.style = b.style;
      if (b.confirm) {
        button.confirm = {
          title: { type: "plain_text", text: "Are you sure?" },
          text: { type: "plain_text", text: b.confirm },
          confirm: { type: "plain_text", text: b.text },
          deny: { type: "plain_text", text: "Cancel" },
        };
      }
      elements.push(button);
    }
  }
  if (elements.length) blocks.push({ type: "actions", elements: elements.slice(0, 5) });
  if (opts.resolvedNote) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: slackEscape(opts.resolvedNote) }] });
  }
  return blocks;
}

/** Several batched notifications for one person, as one message. */
export function buildDigestBlocks(cards: StoredCard[], baseUrl: string): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `*${cards.length} updates from Green Dog Ops*` }],
    },
  ];
  // Slack allows 50 blocks per message; each card uses at most 4 + a divider.
  const shown = cards.slice(0, 9);
  shown.forEach((card, i) => {
    if (i > 0) blocks.push({ type: "divider" });
    blocks.push(...messageSections(card.msg));
    if (card.msg.href) {
      blocks.push({
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: `<${absoluteUrl(card.msg.href, baseUrl)}|${slackEscape(card.msg.linkLabel || "Open in GDD Ops")}>`,
        }],
      });
    }
  });
  if (cards.length > shown.length) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `…and ${cards.length - shown.length} more in Green Dog Ops.` }],
    });
  }
  return blocks;
}

/** Read a StoredCard back from notification_delivery.blocks. */
export function parseStoredCard(raw: unknown): StoredCard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { msg?: unknown; actions?: unknown };
  const m = r.msg as RenderedMessage | undefined;
  if (!m || typeof m.title !== "string") return null;
  const actions = Array.isArray(r.actions)
    ? r.actions.filter((a): a is NotifyActionId => typeof a === "string" && isNotifyActionId(a))
    : [];
  return { msg: m, actions };
}
