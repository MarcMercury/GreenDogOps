import { createAdminClient } from "@/lib/supabase/admin";
import type { Agent, AgentReport, AgentRun } from "@/lib/admin/agents";
import { AgentsView } from "./agents-view";

export const dynamic = "force-dynamic";

export default async function AdminAgentsPage() {
  const admin = createAdminClient();

  const [agentsRes, reportsRes, runsRes] = await Promise.all([
    admin
      .from("agent")
      .select(
        "id, key, name, description, category, schedule_cron, timezone, enabled, config, last_run_at, last_status, created_at, updated_at",
      )
      .order("created_at", { ascending: true }),
    admin
      .from("agent_report")
      .select(
        "id, agent_id, key, name, scope, description, target, enabled, sort_order, config, last_run_at, last_status",
      )
      .order("sort_order", { ascending: true }),
    admin
      .from("agent_run")
      .select(
        "id, agent_id, trigger, status, target_date, started_at, finished_at, duration_ms, records_processed, records_new, tokens_input, tokens_output, cost_usd, triggered_by, triggered_by_email, error, detail, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const agents = (agentsRes.data ?? []) as Agent[];
  const reports = (reportsRes.data ?? []) as AgentReport[];
  const runs = (runsRes.data ?? []) as AgentRun[];

  return <AgentsView agents={agents} reports={reports} runs={runs} />;
}
