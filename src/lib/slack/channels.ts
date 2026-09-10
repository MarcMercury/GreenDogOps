import "server-only";

// ---------------------------------------------------------------------------
// Channel allow-list.
//
// Server actions accept a channel KEY, never a raw channel id from the client —
// otherwise any signed-in user could make the bot post into any channel it has
// been invited to. Keys resolve to ids/names via env so channels can be moved
// without a deploy.
//
// Env values may be a channel id (`C01ABCDEF`, preferred — survives renames) or
// a `#channel-name`.
// ---------------------------------------------------------------------------

export const SLACK_CHANNEL_KEYS = ["hiring"] as const;

export type SlackChannelKey = (typeof SLACK_CHANNEL_KEYS)[number];

const CHANNEL_ENV: Record<SlackChannelKey, string> = {
  hiring: "SLACK_CHANNEL_HIRING",
};

export const SLACK_CHANNEL_LABELS: Record<SlackChannelKey, string> = {
  hiring: "Hiring",
};

export function isSlackChannelKey(value: string): value is SlackChannelKey {
  return (SLACK_CHANNEL_KEYS as readonly string[]).includes(value);
}

/**
 * Resolve a channel key to the id/name configured for it, falling back to
 * SLACK_DEFAULT_CHANNEL. Returns null when neither is set.
 */
export function resolveSlackChannel(key: SlackChannelKey): string | null {
  const value =
    process.env[CHANNEL_ENV[key]] ?? process.env.SLACK_DEFAULT_CHANNEL;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
