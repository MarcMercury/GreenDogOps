// Scheduled-job health for Admin ▸ Agents and the admin work list.
// Pure — the rows come from greendogops.agent (migration 0231).

export type HealthState = "ok" | "warning" | "stale" | "failing" | "stuck" | "never_run" | "disabled";

export type ErrorCategory =
  | "credentials"
  | "access"
  | "config"
  | "rate_limit"
  | "timeout"
  | "network"
  | "external"
  | "data";

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  credentials: "Credentials",
  access: "Access / not shared",
  config: "Configuration",
  rate_limit: "Rate limited",
  timeout: "Timed out",
  network: "Network",
  external: "External service",
  data: "Data / code",
};

export const HEALTH_LABELS: Record<HealthState, string> = {
  ok: "Healthy",
  warning: "Partial",
  stale: "Stale",
  failing: "Failing",
  stuck: "Stuck",
  never_run: "Never run",
  disabled: "Disabled",
};

/** Consecutive failures at which a job counts as repeatedly failing. */
export const REPEATED_FAILURES = 2;
/** A run still "running"/"queued" after this long has died without finishing. */
const STUCK_AFTER_MINUTES = 90;

/** Rough cause of an error message, so the fix is obvious at a glance. */
export function classifyAgentError(error: string | null | undefined): ErrorCategory | null {
  const e = error?.trim();
  if (!e) return null;
  if (/invalid_grant|invalid_auth|not_authed|token_(revoked|expired)|unauthori[sz]ed|\b401\b|refresh token|credentials?/i.test(e)) {
    return "credentials";
  }
  if (/not (set|configured)|isn't configured|is not set|no google calendars configured|missing env|did not resolve/i.test(e)) return "config";
  if (/missing_scope|forbidden|permission|\b403\b|not found|\b404\b/i.test(e)) return "access";
  if (/rate.?limit|\b429\b|quota/i.test(e)) return "rate_limit";
  if (/timed? ?out|timeout|etimedout|deadline|aborted|within \d+s/i.test(e)) return "timeout";
  if (/econn|enotfound|eai_again|fetch failed|socket|network/i.test(e)) return "network";
  if (/\b5\d\d\b|internal_error|service unavailable|bad gateway/i.test(e)) return "external";
  return "data";
}

export interface HealthAgent {
  enabled: boolean;
  config: Record<string, unknown> | null;
  last_run_at: string | null;
  last_status: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number | null;
}

export interface HealthLatestRun {
  status: string;
  started_at: string | null;
  created_at: string;
}

export interface AgentHealth {
  state: HealthState;
  category: ErrorCategory | null;
  /** Minutes since the last success, or null if it never succeeded. */
  minutesSinceSuccess: number | null;
  staleAfterMinutes: number | null;
  /** One line for the table / work item. */
  summary: string;
}

function minutesBetween(fromIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / 60000));
}

export function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function agentHealth(agent: HealthAgent, latestRun: HealthLatestRun | null, now: Date = new Date()): AgentHealth {
  const raw = Number((agent.config ?? {}).stale_after_minutes);
  const staleAfterMinutes = Number.isFinite(raw) && raw > 0 ? raw : null;
  const minutesSinceSuccess = agent.last_success_at ? minutesBetween(agent.last_success_at, now) : null;
  const failures = agent.consecutive_failures ?? 0;
  const category = classifyAgentError(agent.last_error);
  const base = { category, minutesSinceSuccess, staleAfterMinutes };

  if (!agent.enabled) return { ...base, state: "disabled", summary: "Disabled — not running on its schedule." };

  if (latestRun && (latestRun.status === "running" || latestRun.status === "queued")) {
    const since = minutesBetween(latestRun.started_at ?? latestRun.created_at, now);
    if (since >= STUCK_AFTER_MINUTES) {
      return { ...base, state: "stuck", summary: `A run has been ${latestRun.status} for ${formatMinutes(since)} without finishing.` };
    }
  }

  if (failures > 0) {
    const what = failures === 1 ? "The last run failed" : `Failed ${failures} runs in a row`;
    return { ...base, state: "failing", summary: agent.last_error ? `${what}: ${agent.last_error}` : `${what}.` };
  }

  if (!agent.last_run_at && !agent.last_success_at) {
    return { ...base, state: "never_run", summary: "No run recorded yet." };
  }

  if (staleAfterMinutes != null && (minutesSinceSuccess == null || minutesSinceSuccess > staleAfterMinutes)) {
    return {
      ...base,
      state: "stale",
      summary:
        minutesSinceSuccess == null
          ? "Has never succeeded."
          : `No success for ${formatMinutes(minutesSinceSuccess)} (expected within ${formatMinutes(staleAfterMinutes)}).`,
    };
  }

  if (agent.last_error) return { ...base, state: "warning", summary: `Last run partly failed: ${agent.last_error}` };

  return { ...base, state: "ok", summary: "Healthy." };
}

/**
 * Worth an item on an admin's work list. One failure of a job that runs every
 * few minutes is usually transient; a daily or weekly job won't retry for a
 * day, so its first failure counts.
 */
export function needsAttention(agent: HealthAgent, health: AgentHealth): boolean {
  if (health.state === "stale" || health.state === "stuck") return true;
  if (health.state !== "failing") return false;
  const failures = agent.consecutive_failures ?? 0;
  return failures >= REPEATED_FAILURES || (health.staleAfterMinutes ?? 0) >= 1440;
}

/**
 * Whether a cron outcome gets its own agent_run row ("run") or only updates the
 * agent ("stamp"). Failures and changes are recorded; a quiet success, or the
 * same error as last time with nothing done, is just counted on the agent.
 */
export function cronRecordMode(o: {
  error: string | null;
  changed: number;
  everyRun?: boolean;
  lastError: string | null;
}): "run" | "stamp" {
  if (o.everyRun) return "run";
  if (o.changed > 0) return "run";
  if (!o.error) return "stamp";
  return o.error === o.lastError ? "stamp" : "run";
}
