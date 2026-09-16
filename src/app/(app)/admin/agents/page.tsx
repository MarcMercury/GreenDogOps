import { createAdminClient } from "@/lib/supabase/admin";
import type { Agent, AgentReport, AgentRun } from "@/lib/admin/agents";
import type { SheetSyncIssue, SheetSyncSource } from "@/lib/admin/sheet-sync";
import { AgentsView } from "./agents-view";
import { SheetSyncPanel } from "./sheet-sync-panel";

export const dynamic = "force-dynamic";

export default async function AdminAgentsPage() {
  const admin = createAdminClient();

  const [agentsRes, reportsRes, runsRes, sourcesRes, issuesRes] = await Promise.all([
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
    admin
      .from("sheet_sync_source")
      .select(
        "id, key, name, description, spreadsheet_url, enabled, last_modified_time, last_synced_at, last_status, last_error, last_summary",
      )
      .order("key", { ascending: true }),
    admin
      .from("sheet_sync_issue")
      .select("id, source_key, kind, subject, detail, status, first_seen_at, last_seen_at")
      .eq("status", "open")
      .order("last_seen_at", { ascending: false })
      .limit(200),
  ]);

  const agents = (agentsRes.data ?? []) as Agent[];
  const reports = (reportsRes.data ?? []) as AgentReport[];
  const runs = (runsRes.data ?? []) as AgentRun[];
  const sources = (sourcesRes.data ?? []) as SheetSyncSource[];
  const issues = (issuesRes.data ?? []) as SheetSyncIssue[];

  return (
    <div className="space-y-6">
      <SheetSyncPanel sources={sources} issues={issues} />
      <AgentsView agents={agents} reports={reports} runs={runs} />
    </div>
  );
}
