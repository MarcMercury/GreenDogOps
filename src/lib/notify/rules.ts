// Rules for delivering Ops notifications to Slack. Pure — the dispatcher in
// ./dispatch.ts applies them.

/** A pending DM older than this is skipped instead of sent late. */
export const DM_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** A delivery stuck in `sending` this long is failed, never resent. */
export const DM_STUCK_AFTER_MS = 15 * 60 * 1000;
export const DM_MAX_ATTEMPTS = 3;

export type DmGate = { send: true } | { send: false; reason: string };

/**
 * Real DMs go out only when SLACK_DM_LIVE=true, or to Slack ids listed in
 * SLACK_DM_TEST_USER_IDS (comma-separated) while testing.
 */
export function dmGate(env: { live?: string; testIds?: string }, slackUserId: string): DmGate {
  if (env.live?.trim().toLowerCase() === "true") return { send: true };
  const allow = (env.testIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.includes(slackUserId)) return { send: true };
  return { send: false, reason: "Slack DMs are off (SLACK_DM_LIVE is not true)." };
}

export type RetryDecision =
  | { status: "pending"; delayMs: number }
  | { status: "failed" };

/**
 * Only retry when Slack told us it did NOT deliver (rate limit, server error
 * returned as a response). A thrown error / timeout may have delivered, so it
 * is never retried.
 */
export function retryDecision(
  code: string,
  attemptsSoFar: number,
  retryAfterSec?: number | null,
): RetryDecision {
  const retryable = code === "ratelimited" || code === "internal_error" || code === "fatal_error" || code === "service_unavailable";
  if (!retryable || attemptsSoFar >= DM_MAX_ATTEMPTS) return { status: "failed" };
  const backoff = 60_000 * 2 ** Math.max(0, attemptsSoFar - 1);
  const hinted = retryAfterSec && retryAfterSec > 0 ? retryAfterSec * 1000 : 0;
  return { status: "pending", delayMs: Math.min(Math.max(backoff, hinted), 30 * 60_000) };
}

/** Escape text for Slack mrkdwn (only &, <, > are special). */
export function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface DmContent {
  title: string;
  body: string | null;
  href: string | null;
}

/** Plain mrkdwn DM. `baseUrl` has no trailing slash. */
export function buildDmText(n: DmContent, baseUrl: string): string {
  const lines = [`*${slackEscape(n.title)}*`];
  if (n.body?.trim()) lines.push(slackEscape(n.body.trim()));
  if (n.href) {
    const url = n.href.startsWith("/") ? `${baseUrl}${n.href}` : n.href;
    const label = n.href.startsWith("/") ? "Open in Green Dog Ops" : "Open in Slack";
    lines.push(`<${url}|${label}>`);
  }
  return lines.join("\n");
}
