import "server-only";

// ---------------------------------------------------------------------------
// Slack messaging via a bot token (`xoxb-…`).
//
// Messages are posted by the Green Dog Ops app, but `chat:write.customize` lets
// us set the display name + avatar per message so a post reads as the signed-in
// user who triggered it (Slack still shows a small APP badge — only a per-user
// OAuth token can remove that).
//
// Required env:
//   SLACK_BOT_TOKEN        — bot token from the Slack app's OAuth page.
//                            Scopes: chat:write, chat:write.customize,
//                            channels:join (to self-join public channels).
//   SLACK_CHANNEL_*        — see ./channels.ts. The bot must be a member of
//                            private channels (`/invite @Green Dog Ops`).
// Optional:
//   SLACK_DEFAULT_ICON_URL — avatar used when the caller has none.
//
// Never throws: failures come back as `{ ok: false, error }` so a Slack outage
// can never fail the user's actual action.
// ---------------------------------------------------------------------------

import { resolveSlackChannel, type SlackChannelKey } from "./channels";

const SLACK_API = "https://slack.com/api";
const TIMEOUT_MS = 10_000;

export interface PostSlackMessageInput {
  /** Allow-listed channel key — never a raw id from the browser. */
  channelKey: SlackChannelKey;
  /** Message body in Slack mrkdwn (`*bold*`, `_italic_`). */
  text: string;
  /** Display name for this message, e.g. the signed-in user's full name. */
  username?: string | null;
  /** Avatar for this message. Must be a public https URL. */
  iconUrl?: string | null;
  /** `ts` of a parent message to reply in-thread. */
  threadTs?: string;
}

export interface PostSlackMessageResult {
  ok: boolean;
  /** Message timestamp/id, when the post succeeded. */
  ts?: string;
  channel?: string;
  error?: string;
}

/** True when a bot token is configured. */
export function isSlackConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

async function slackApi(
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SlackApiResponse> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return (await res.json()) as SlackApiResponse;
}

// conversations.join only accepts an id, not a #name.
function isChannelId(channel: string): boolean {
  return /^[CG][A-Z0-9]+$/.test(channel);
}

const ERROR_HINTS: Record<string, string> = {
  not_in_channel:
    "The Green Dog Ops app is not in that channel. Invite it with /invite @Green Dog Ops.",
  channel_not_found:
    "Channel not found. Check the SLACK_CHANNEL_* value and that the app is installed in this workspace.",
  invalid_auth: "SLACK_BOT_TOKEN is invalid or has been revoked.",
  missing_scope:
    "The Slack app is missing a scope. Add chat:write and chat:write.customize, then reinstall it.",
  is_archived: "That Slack channel is archived.",
  ratelimited: "Slack is rate limiting us. Try again in a moment.",
};

/**
 * Post a message to an allow-listed channel, optionally attributed to a user.
 */
export async function postSlackMessage(
  input: PostSlackMessageInput,
): Promise<PostSlackMessageResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return {
      ok: false,
      error: "Slack is not configured. Set SLACK_BOT_TOKEN in .env.local / Vercel.",
    };
  }

  const channel = resolveSlackChannel(input.channelKey);
  if (!channel) {
    return {
      ok: false,
      error: `No Slack channel configured for "${input.channelKey}".`,
    };
  }

  const text = input.text.trim();
  if (!text) return { ok: false, error: "Nothing to post." };

  const payload: Record<string, unknown> = {
    channel,
    text,
    unfurl_links: false,
    unfurl_media: false,
  };
  if (input.username) payload.username = input.username;
  const iconUrl = input.iconUrl ?? process.env.SLACK_DEFAULT_ICON_URL;
  if (iconUrl) payload.icon_url = iconUrl;
  if (input.threadTs) payload.thread_ts = input.threadTs;

  try {
    let data = await slackApi("chat.postMessage", token, payload);

    // Public channels: join once and retry rather than making someone /invite.
    if (!data.ok && data.error === "not_in_channel" && isChannelId(channel)) {
      const joined = await slackApi("conversations.join", token, { channel });
      if (joined.ok) data = await slackApi("chat.postMessage", token, payload);
    }

    if (!data.ok) {
      const code = data.error ?? "unknown_error";
      return { ok: false, error: ERROR_HINTS[code] ?? `Slack error: ${code}` };
    }
    return { ok: true, ts: data.ts, channel: data.channel };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not reach Slack: ${message}` };
  }
}
