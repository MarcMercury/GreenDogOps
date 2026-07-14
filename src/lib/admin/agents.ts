// Agents module (Admin) — types, labels, and shared helpers for the automation
// control plane. See migration 0088_agents_module.sql.

export type AgentStatus =
  | "queued"
  | "running"
  | "success"
  | "error"
  | "cancelled";

export type AgentRunTrigger = "scheduled" | "manual";

export type AgentReportScope = "global" | "per_location";

export interface Agent {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  schedule_cron: string | null;
  timezone: string;
  enabled: boolean;
  config: Record<string, unknown>;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentReport {
  id: string;
  agent_id: string;
  key: string;
  name: string;
  scope: AgentReportScope;
  description: string | null;
  target: string | null;
  enabled: boolean;
  sort_order: number;
  config: Record<string, unknown>;
  last_run_at: string | null;
  last_status: string | null;
}

export interface AgentRun {
  id: string;
  agent_id: string;
  trigger: AgentRunTrigger;
  status: AgentStatus;
  target_date: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  records_processed: number;
  records_new: number;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  triggered_by: string | null;
  triggered_by_email: string | null;
  error: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface AgentRunLog {
  id: string;
  run_id: string;
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
  data: Record<string, unknown>;
}

export const AGENT_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  success: "Success",
  error: "Error",
  cancelled: "Cancelled",
};

/** Tailwind ring/badge classes per run status. */
export const AGENT_STATUS_BADGE: Record<string, string> = {
  queued: "bg-slate-100 text-slate-600 ring-slate-200",
  running: "bg-blue-50 text-blue-700 ring-blue-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  error: "bg-rose-50 text-rose-700 ring-rose-200",
  cancelled: "bg-amber-50 text-amber-700 ring-amber-200",
};

export const SCOPE_LABELS: Record<AgentReportScope, string> = {
  global: "Global",
  per_location: "Per clinic",
};

/** A status is "active" (in-flight) when queued or running. */
export function isActiveStatus(status: string | null | undefined): boolean {
  return status === "queued" || status === "running";
}

export function fmtCost(usd: number | null | undefined): string {
  const n = usd ?? 0;
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtTokens(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v === 0) return "0";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}
