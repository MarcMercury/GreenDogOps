"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, recordAudit } from "@/lib/auth/session";
import { dispatchAgentWorker } from "@/lib/admin/agent-runner";
import type { Agent } from "@/lib/admin/agents";

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Yesterday's date (America/Los_Angeles) as YYYY-MM-DD — the default target. */
function previousDayLA(): string {
  const now = new Date();
  // Shift to LA, then step back one day.
  const la = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  la.setDate(la.getDate() - 1);
  const y = la.getFullYear();
  const m = String(la.getMonth() + 1).padStart(2, "0");
  const d = String(la.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Manually trigger an agent run now (Admin ▸ Agents ▸ "Run now"). */
export async function runAgentNow(agentId: string): Promise<ActionResult> {
  const current = await requireAdmin();
  const admin = createAdminClient();

  const { data: agentRow, error: agentErr } = await admin
    .from("agent")
    .select(
      "id, key, name, description, category, schedule_cron, timezone, enabled, config, last_run_at, last_status, created_at, updated_at",
    )
    .eq("id", agentId)
    .single();
  if (agentErr || !agentRow) {
    return { ok: false, error: agentErr?.message ?? "Agent not found." };
  }
  const agent = agentRow as Agent;
  if (!agent.enabled) {
    return { ok: false, error: "This agent is disabled. Enable it before running." };
  }

  // Guard against stacking runs: don't queue a second one while one is active.
  const { data: active } = await admin
    .from("agent_run")
    .select("id")
    .eq("agent_id", agentId)
    .in("status", ["queued", "running"])
    .limit(1);
  if (active && active.length > 0) {
    return { ok: false, error: "A run is already queued or in progress." };
  }

  const targetDate = previousDayLA();
  const { data: run, error: runErr } = await admin
    .from("agent_run")
    .insert({
      agent_id: agentId,
      trigger: "manual",
      status: "queued",
      target_date: targetDate,
      triggered_by: current.authId,
      triggered_by_email: current.email,
    })
    .select("id")
    .single();
  if (runErr || !run) {
    return { ok: false, error: runErr?.message ?? "Failed to create run." };
  }
  const runId = run.id as string;

  const dispatch = await dispatchAgentWorker(agent, runId, targetDate);

  await admin
    .from("agent")
    .update({ last_run_at: new Date().toISOString(), last_status: "queued" })
    .eq("id", agentId);

  await admin.from("agent_run_log").insert({
    run_id: runId,
    level: dispatch.dispatched ? "info" : "warn",
    message: dispatch.note,
  });

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "agent.run_triggered",
    entity: "agent",
    entityId: agentId,
    summary: `Manually ran ${agent.name} for ${targetDate}`,
    metadata: { runId, dispatched: dispatch.dispatched },
  });

  revalidatePath("/admin/agents");
  return {
    ok: true,
    message: dispatch.dispatched
      ? `Run queued and worker dispatched for ${targetDate}.`
      : `Run queued for ${targetDate}. ${dispatch.note}`,
  };
}

/** Enable or disable an agent. */
export async function setAgentEnabled(
  agentId: string,
  enabled: boolean,
): Promise<ActionResult> {
  const current = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("agent").update({ enabled }).eq("id", agentId);
  if (error) return { ok: false, error: error.message };

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "agent.toggled",
    entity: "agent",
    entityId: agentId,
    summary: `${enabled ? "Enabled" : "Disabled"} agent`,
  });

  revalidatePath("/admin/agents");
  return { ok: true, message: enabled ? "Agent enabled." : "Agent disabled." };
}
