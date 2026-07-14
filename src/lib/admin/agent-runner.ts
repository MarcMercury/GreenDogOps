import "server-only";

import type { Agent } from "./agents";

/**
 * Dispatch the off-Vercel browser worker for an agent run.
 *
 * The heavy browser automation (Playwright/Chromium logging into ezyVet) can't
 * run inside a Vercel function, so it lives in a GitHub Actions workflow that we
 * trigger via `workflow_dispatch`. The worker receives the run id and reports
 * progress back to /api/agents/ingest (CRON_SECRET-gated).
 *
 * Configuration (env):
 *   AGENT_DISPATCH_TOKEN   GitHub PAT / fine-grained token with `actions:write`.
 *   AGENT_GITHUB_REPO      "owner/repo" (defaults to GITHUB_REPO if set).
 *   AGENT_WORKFLOW_FILE    Workflow file name (default "ezyvet-agent.yml").
 *   AGENT_WORKFLOW_REF     Git ref to run on (default "main").
 *
 * When the token/repo aren't configured yet, the run stays queued and we return
 * a note explaining what's missing — the manual-run button still records the run.
 */
export async function dispatchAgentWorker(
  agent: Agent,
  runId: string,
  targetDate: string,
): Promise<{ dispatched: boolean; note: string }> {
  const token = process.env.AGENT_DISPATCH_TOKEN;
  const repo = process.env.AGENT_GITHUB_REPO ?? process.env.GITHUB_REPO;
  const workflow = process.env.AGENT_WORKFLOW_FILE ?? "ezyvet-agent.yml";
  const ref = process.env.AGENT_WORKFLOW_REF ?? "main";

  if (!token || !repo) {
    return {
      dispatched: false,
      note: "Worker not configured (set AGENT_DISPATCH_TOKEN + AGENT_GITHUB_REPO). Run queued.",
    };
  }

  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref,
        inputs: {
          run_id: runId,
          agent_key: agent.key,
          target_date: targetDate,
        },
      }),
    });
    if (res.status === 204) {
      return { dispatched: true, note: `Dispatched ${workflow} on ${ref}.` };
    }
    const text = await res.text().catch(() => "");
    return {
      dispatched: false,
      note: `GitHub dispatch failed (${res.status}): ${text.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      dispatched: false,
      note: `Dispatch error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
