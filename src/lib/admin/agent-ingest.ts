import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A progress update posted by the off-Vercel agent worker. Counters
 * (records/tokens/cost) are ADDITIVE so the worker can report incrementally as
 * each report finishes; status/error/detail are set/merged.
 */
export interface AgentRunUpdate {
  runId: string;
  status?: "running" | "success" | "error" | "cancelled";
  recordsProcessed?: number;
  recordsNew?: number;
  tokensInput?: number;
  tokensOutput?: number;
  costUsd?: number;
  error?: string;
  /** Shallow-merged into the run's detail jsonb (e.g. per-report breakdown). */
  detail?: Record<string, unknown>;
  /** One or more log lines to append. */
  logs?: { level?: "info" | "warn" | "error"; message: string; data?: Record<string, unknown> }[];
}

export type AgentRunUpdateResult =
  | { ok: true; status: string }
  | { ok: false; error: string };

const TERMINAL = new Set(["success", "error", "cancelled"]);

export async function applyAgentRunUpdate(
  update: AgentRunUpdate,
): Promise<AgentRunUpdateResult> {
  if (!update.runId) return { ok: false, error: "runId is required" };
  const admin = createAdminClient();

  const { data: run, error: readErr } = await admin
    .from("agent_run")
    .select(
      "id, agent_id, status, started_at, records_processed, records_new, tokens_input, tokens_output, cost_usd, detail",
    )
    .eq("id", update.runId)
    .single();
  if (readErr || !run) {
    return { ok: false, error: readErr?.message ?? "Run not found" };
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  // Status transitions.
  if (update.status) {
    patch.status = update.status;
    if (update.status === "running" && !run.started_at) {
      patch.started_at = nowIso;
    }
    if (TERMINAL.has(update.status)) {
      patch.finished_at = nowIso;
      const started = (patch.started_at as string) ?? (run.started_at as string | null);
      if (started) {
        patch.duration_ms = Math.max(0, Date.now() - new Date(started).getTime());
      }
    }
  }

  // Additive counters.
  if (typeof update.recordsProcessed === "number") {
    patch.records_processed = (run.records_processed ?? 0) + update.recordsProcessed;
  }
  if (typeof update.recordsNew === "number") {
    patch.records_new = (run.records_new ?? 0) + update.recordsNew;
  }
  if (typeof update.tokensInput === "number") {
    patch.tokens_input = (run.tokens_input ?? 0) + update.tokensInput;
  }
  if (typeof update.tokensOutput === "number") {
    patch.tokens_output = (run.tokens_output ?? 0) + update.tokensOutput;
  }
  if (typeof update.costUsd === "number") {
    patch.cost_usd = Number(run.cost_usd ?? 0) + update.costUsd;
  }
  if (typeof update.error === "string") {
    patch.error = update.error;
  }
  if (update.detail && typeof update.detail === "object") {
    patch.detail = { ...(run.detail as Record<string, unknown>), ...update.detail };
  }

  if (Object.keys(patch).length > 0) {
    const { error: updErr } = await admin
      .from("agent_run")
      .update(patch)
      .eq("id", update.runId);
    if (updErr) return { ok: false, error: updErr.message };
  }

  // Append logs.
  if (update.logs && update.logs.length > 0) {
    await admin.from("agent_run_log").insert(
      update.logs.map((l) => ({
        run_id: update.runId,
        level: l.level ?? "info",
        message: l.message,
        data: l.data ?? {},
      })),
    );
  }

  // Keep the parent agent's denormalized last-run summary in sync.
  if (update.status) {
    await admin
      .from("agent")
      .update({ last_run_at: nowIso, last_status: update.status })
      .eq("id", run.agent_id);
  }

  return { ok: true, status: (patch.status as string) ?? (run.status as string) };
}
