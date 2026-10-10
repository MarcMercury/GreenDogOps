import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInWorkTz } from "@/lib/worklist/dates";
import { cronRecordMode } from "./health";

// ---------------------------------------------------------------------------
// Health records for the Vercel crons (migration 0231).
//
// A failed run, or one that changed something, is written to agent_run; the
// agent_run_rollup trigger then updates the agent's last success / failure
// count. A quiet success of a job that runs every few minutes, or a repeat of
// the error already on the agent, only stamps the agent row, so the table
// isn't flooded. Recording never throws: a broken health write must not fail
// the job itself.
// ---------------------------------------------------------------------------

export interface CronOutcome {
  ok: boolean;
  /** Rows created/updated/deleted or messages sent. */
  changed?: number;
  /** Items looked at. */
  processed?: number;
  /** On a failure, why; on a success, a partial problem worth showing. */
  error?: string | null;
  /** The job chose not to run (e.g. the off-hour twin of a DST-safe pair). */
  skipped?: boolean;
  /** Per-part results, rendered as a breakdown in Admin ▸ Agents. */
  detail?: Record<string, unknown>;
}

export interface CronRecordOptions {
  /** Record every run (daily/weekly jobs), not just ones that changed something. */
  everyRun?: boolean;
}

export async function recordCronRun(
  key: string,
  startedAt: Date,
  outcome: CronOutcome,
  options: CronRecordOptions = {},
): Promise<void> {
  if (outcome.skipped) return;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("agent")
      .select("id, last_error, consecutive_failures")
      .eq("key", key)
      .maybeSingle();
    const agent = data as { id: string; last_error: string | null; consecutive_failures: number | null } | null;
    if (!agent) return;

    const finishedAt = new Date();
    const nowIso = finishedAt.toISOString();
    const error = outcome.error?.trim() || (outcome.ok ? null : "Failed without an error message.");
    const changed = outcome.changed ?? 0;

    if (cronRecordMode({ error, changed, everyRun: options.everyRun, lastError: agent.last_error }) === "run") {
      const { error: insErr } = await admin.from("agent_run").insert({
        agent_id: agent.id,
        trigger: "scheduled",
        status: outcome.ok ? "success" : "error",
        target_date: todayInWorkTz(),
        started_at: startedAt.toISOString(),
        finished_at: nowIso,
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        records_processed: outcome.processed ?? 0,
        records_new: changed,
        triggered_by_email: "system:cron",
        error,
        detail: outcome.detail ?? {},
      });
      if (insErr) console.error(`[cron-run] ${key}: could not record run:`, insErr.message);
      return;
    }

    const { error: upErr } = await admin
      .from("agent")
      .update(
        outcome.ok
          ? { last_run_at: nowIso, last_status: "success", last_success_at: nowIso, last_error: error, consecutive_failures: 0 }
          : { last_run_at: nowIso, last_status: "error", consecutive_failures: (agent.consecutive_failures ?? 0) + 1 },
      )
      .eq("id", agent.id);
    if (upErr) console.error(`[cron-run] ${key}: could not stamp agent:`, upErr.message);
  } catch (err) {
    console.error(`[cron-run] ${key}: health record failed:`, err);
  }
}

/**
 * Run a cron job and record its outcome. A thrown error is recorded as a
 * failure and re-thrown, so the route's own error handling is unchanged.
 */
export async function trackCron<T>(
  key: string,
  job: () => Promise<T>,
  outcome: (result: T) => CronOutcome,
  options: CronRecordOptions = {},
): Promise<T> {
  const startedAt = new Date();
  let result: T;
  try {
    result = await job();
  } catch (err) {
    await recordCronRun(key, startedAt, { ok: false, error: err instanceof Error ? err.message : String(err) }, options);
    throw err;
  }
  await recordCronRun(key, startedAt, outcome(result), options);
  return result;
}
