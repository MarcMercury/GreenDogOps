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
//                            channels:join (to self-join public channels);
//                            users:read + users:read.email for ./users.ts.
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

export type SlackDmResult =
  | { ok: true; ts: string | null; channel: string | null }
  | {
      ok: false;
      /** Slack error code, or "timeout"/"network" when the request itself failed. */
      code: string;
      error: string;
      retryAfterSec: number | null;
    };

/** One Web API call with the error mapping the notification dispatcher relies on. */
async function callSlackApi(
  method: string,
  body: Record<string, unknown>,
): Promise<SlackDmResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return { ok: false, code: "not_configured", error: "SLACK_BOT_TOKEN is not set.", retryAfterSec: null };
  }
  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const retryAfter = Number(res.headers.get("retry-after"));
    const retryAfterSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
    if (res.status === 429) {
      return { ok: false, code: "ratelimited", error: ERROR_HINTS.ratelimited, retryAfterSec };
    }
    const data = (await res.json()) as SlackApiResponse;
    if (!data.ok) {
      const code = data.error ?? "unknown_error";
      return { ok: false, code, error: ERROR_HINTS[code] ?? `Slack error: ${code}`, retryAfterSec };
    }
    return { ok: true, ts: data.ts ?? null, channel: data.channel ?? null };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: timedOut ? "timeout" : "network",
      error: `Could not reach Slack: ${message}`,
      retryAfterSec: null,
    };
  }
}

/**
 * DM one Slack user from the app (`chat.postMessage` with the user id as the
 * channel; needs only chat:write). Never sets username/icon — DMs always come
 * from the app itself. Callers must have checked that the person may be
 * messaged (src/lib/notify/dispatch.ts).
 */
export async function sendSlackDirectMessage(
  slackUserId: string,
  text: string,
  blocks?: Record<string, unknown>[],
): Promise<SlackDmResult> {
  if (!/^[UW][A-Z0-9]+$/.test(slackUserId)) {
    return { ok: false, code: "invalid_user", error: "Not a Slack user id.", retryAfterSec: null };
  }
  const body: Record<string, unknown> = { channel: slackUserId, text, unfurl_links: false, unfurl_media: false };
  if (blocks?.length) body.blocks = blocks;
  return callSlackApi("chat.postMessage", body);
}

/**
 * Post to a channel by id (chosen by an admin in Admin ▸ Notifications).
 * Public channels are joined automatically; private ones need
 * /invite @Green Dog Ops.
 */
export async function postSlackChannelMessage(
  channelId: string,
  text: string,
  blocks?: Record<string, unknown>[],
): Promise<SlackDmResult> {
  if (!isChannelId(channelId)) {
    return { ok: false, code: "invalid_channel", error: "Not a Slack channel id.", retryAfterSec: null };
  }
  const body: Record<string, unknown> = { channel: channelId, text, unfurl_links: false, unfurl_media: false };
  if (blocks?.length) body.blocks = blocks;
  let res = await callSlackApi("chat.postMessage", body);
  if (!res.ok && res.code === "not_in_channel") {
    const joined = await callSlackApi("conversations.join", { channel: channelId });
    if (joined.ok) res = await callSlackApi("chat.postMessage", body);
  }
  return res;
}

/** Replace a message the app posted earlier (e.g. a PTO card once it's decided). */
export async function updateSlackMessage(
  channel: string,
  ts: string,
  text: string,
  blocks?: Record<string, unknown>[],
): Promise<SlackDmResult> {
  const body: Record<string, unknown> = { channel, ts, text };
  if (blocks) body.blocks = blocks;
  return callSlackApi("chat.update", body);
}

export interface SlackChannelOption {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

/**
 * Channels the bot can see (public, plus private ones it was invited to).
 * Needs channels:read and groups:read.
 */
export async function listSlackChannels(): Promise<{ ok: true; channels: SlackChannelOption[] } | { ok: false; error: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, error: "SLACK_BOT_TOKEN is not set." };
  const out: SlackChannelOption[] = [];
  let cursor = "";
  try {
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: "200",
      });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`${SLACK_API}/conversations.list?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        channels?: { id: string; name: string; is_private?: boolean; is_member?: boolean }[];
        response_metadata?: { next_cursor?: string };
      };
      if (!data.ok) {
        const code = data.error ?? "unknown_error";
        return { ok: false, error: ERROR_HINTS[code] ?? `Slack error: ${code}` };
      }
      for (const c of data.channels ?? []) {
        out.push({ id: c.id, name: c.name, isPrivate: !!c.is_private, isMember: !!c.is_member });
      }
      cursor = data.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
    }
  } catch (err) {
    return { ok: false, error: `Could not reach Slack: ${err instanceof Error ? err.message : String(err)}` };
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, channels: out };
}

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
