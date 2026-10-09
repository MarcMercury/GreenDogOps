import "server-only";

// ---------------------------------------------------------------------------
// Ops → Slack workflows.
//
// A Slack Workflow Builder workflow that "Starts with a webhook" gets a URL
// like https://hooks.slack.com/triggers/T…/…/…. Set it as
// SLACK_WORKFLOW_WEBHOOK_URL and Ops POSTs task events to it; the workflow
// branches on `event`. Slack webhook variables are flat strings, so every
// field is a string ("" when empty).
//
// Off until the env var is set. One attempt, 5 s timeout, never throws, never
// retried (a retry could start the workflow twice). Events for tasks that
// came FROM Slack are not echoed back as task.created, so a workflow can't
// loop.
// ---------------------------------------------------------------------------

export type SlackWorkflowEvent = "task.created" | "task.completed" | "task.dismissed";

const TRIGGER_URL = /^https:\/\/hooks\.slack\.com\/triggers\/[A-Za-z0-9/_-]+$/;

export function slackWorkflowConfigured(): boolean {
  const url = process.env.SLACK_WORKFLOW_WEBHOOK_URL?.trim();
  return !!url && TRIGGER_URL.test(url);
}

export async function emitSlackWorkflowEvent(
  event: SlackWorkflowEvent,
  fields: Record<string, string | null | undefined>,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const url = process.env.SLACK_WORKFLOW_WEBHOOK_URL?.trim();
  if (!url) return { ok: true, skipped: true };
  if (!TRIGGER_URL.test(url)) {
    return { ok: false, error: "SLACK_WORKFLOW_WEBHOOK_URL must be a https://hooks.slack.com/triggers/ URL." };
  }
  const payload: Record<string, string> = { event };
  for (const [k, v] of Object.entries(fields)) payload[k] = (v ?? "").slice(0, 2000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { ok: false, error: `Slack workflow webhook returned ${res.status}.` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
