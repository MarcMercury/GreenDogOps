import "server-only";

// ---------------------------------------------------------------------------
// Slack workspace members, read with the bot token.
//
// Needs the `users:read` and `users:read.email` scopes on the Green Dog Ops
// Slack app. Without users:read.email Slack silently omits every email, so we
// check the granted scopes and fail loudly instead of reporting everyone as
// "not found".
//
// One users.list sweep (200 per page) serves a whole sync, rather than one
// users.lookupByEmail call per employee.
// ---------------------------------------------------------------------------

import type { SlackMember } from "./matching";

const SLACK_API = "https://slack.com/api";
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 30_000;
const MAX_PAGES = 50;

export const REQUIRED_USER_SCOPES = ["users:read", "users:read.email"] as const;

interface RawSlackMember {
  id: string;
  team_id?: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  real_name?: string;
  profile?: {
    email?: string;
    display_name?: string;
    real_name?: string;
  };
}

interface SlackResponse {
  ok: boolean;
  error?: string;
  needed?: string;
  members?: RawSlackMember[];
  user?: RawSlackMember;
  response_metadata?: { next_cursor?: string };
}

export class SlackApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "SlackApiError";
  }
}

function hint(code: string, needed?: string): string {
  switch (code) {
    case "missing_scope":
      return `The Green Dog Ops Slack app is missing the ${needed ?? "users:read / users:read.email"} scope. Add it under OAuth & Permissions, reinstall the app, and update SLACK_BOT_TOKEN if it changed.`;
    case "invalid_auth":
    case "not_authed":
    case "token_revoked":
      return "SLACK_BOT_TOKEN is invalid or has been revoked.";
    case "user_not_found":
      return "That Slack user does not exist in this workspace.";
    case "ratelimited":
      return "Slack is rate limiting us. Try again in a minute.";
    default:
      return `Slack error: ${code}`;
  }
}

function token(): string {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) {
    throw new SlackApiError(
      "Slack is not configured. Set SLACK_BOT_TOKEN in .env.local / Vercel.",
      "not_configured",
    );
  }
  return t;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a Slack Web API read method, retrying only on 429 (bounded). */
async function slackGet(
  method: string,
  params: Record<string, string>,
): Promise<{ data: SlackResponse; scopes: string[] | null }> {
  const url = `${SLACK_API}/${method}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token()}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      if (err instanceof SlackApiError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new SlackApiError(`Could not reach Slack (${method}): ${message}`, "network");
    }

    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get("retry-after")) || 5;
      await sleep(Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS));
      continue;
    }

    const scopesHeader = res.headers.get("x-oauth-scopes");
    const scopes = scopesHeader
      ? scopesHeader.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    let data: SlackResponse;
    try {
      data = (await res.json()) as SlackResponse;
    } catch {
      throw new SlackApiError(`Slack ${method} returned HTTP ${res.status}.`, `http_${res.status}`);
    }
    if (!data.ok) {
      const code = data.error ?? (res.status === 429 ? "ratelimited" : "unknown_error");
      throw new SlackApiError(hint(code, data.needed), code);
    }
    return { data, scopes };
  }
}

function toMember(m: RawSlackMember): SlackMember {
  return {
    id: m.id,
    teamId: m.team_id ?? null,
    username: m.name ?? null,
    email: m.profile?.email ?? null,
    displayName: m.profile?.display_name || null,
    realName: m.profile?.real_name || m.real_name || null,
    deleted: Boolean(m.deleted),
    isBot: Boolean(m.is_bot || m.is_app_user),
  };
}

function assertEmailScope(scopes: string[] | null) {
  if (scopes && !scopes.includes("users:read.email")) {
    throw new SlackApiError(hint("missing_scope", "users:read.email"), "missing_scope");
  }
}

/** Every member of the workspace, including deactivated accounts. */
export async function listSlackMembers(): Promise<SlackMember[]> {
  const members: SlackMember[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = { limit: "200" };
    if (cursor) params.cursor = cursor;
    const { data, scopes } = await slackGet("users.list", params);
    if (page === 0) assertEmailScope(scopes);
    for (const m of data.members ?? []) members.push(toMember(m));
    cursor = data.response_metadata?.next_cursor ?? "";
    if (!cursor) return members;
  }
  throw new SlackApiError(
    `Slack users.list did not finish within ${MAX_PAGES} pages.`,
    "too_many_pages",
  );
}

/** One Slack member by id, or null when the id doesn't exist. */
export async function getSlackMember(slackUserId: string): Promise<SlackMember | null> {
  try {
    const { data } = await slackGet("users.info", { user: slackUserId });
    return data.user ? toMember(data.user) : null;
  } catch (err) {
    if (err instanceof SlackApiError && err.code === "user_not_found") return null;
    throw err;
  }
}

export interface SlackWorkspaceStatus {
  configured: boolean;
  ok: boolean;
  team: string | null;
  url: string | null;
  missingScopes: string[];
  error: string | null;
}

/** Which workspace the bot token belongs to, and whether it can read users. */
export async function getSlackWorkspaceStatus(): Promise<SlackWorkspaceStatus> {
  if (!process.env.SLACK_BOT_TOKEN) {
    return { configured: false, ok: false, team: null, url: null, missingScopes: [], error: null };
  }
  try {
    const { data, scopes } = await slackGet("auth.test", {});
    const raw = data as SlackResponse & { team?: string; url?: string };
    const missingScopes = scopes
      ? REQUIRED_USER_SCOPES.filter((s) => !scopes.includes(s))
      : [];
    return {
      configured: true,
      ok: missingScopes.length === 0,
      team: raw.team ?? null,
      url: raw.url ?? null,
      missingScopes,
      error: null,
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      team: null,
      url: null,
      missingScopes: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
