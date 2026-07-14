"use client";

import { useState, useTransition } from "react";
import { Panel, StatCard } from "../_components";
import {
  AGENT_STATUS_BADGE,
  AGENT_STATUS_LABELS,
  SCOPE_LABELS,
  fmtCost,
  fmtDuration,
  fmtTokens,
  isActiveStatus,
  type Agent,
  type AgentReport,
  type AgentRun,
} from "@/lib/admin/agents";
import { runAgentNow, setAgentEnabled } from "./actions";

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusBadge({ status }: { status: string | null }) {
  const key = status ?? "queued";
  const cls = AGENT_STATUS_BADGE[key] ?? AGENT_STATUS_BADGE.queued;
  const label = AGENT_STATUS_LABELS[key] ?? key;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${cls}`}
    >
      {label}
    </span>
  );
}

function ScopeBadge({ scope }: { scope: string }) {
  const perClinic = scope === "per_location";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${
        perClinic
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      {SCOPE_LABELS[scope as "global" | "per_location"] ?? scope}
    </span>
  );
}

function AgentCard({
  agent,
  reports,
  runs,
}: {
  agent: Agent;
  reports: AgentReport[];
  runs: AgentRun[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const agentRuns = runs.filter((r) => r.agent_id === agent.id);
  const agentReports = reports
    .filter((r) => r.agent_id === agent.id)
    .sort((a, b) => a.sort_order - b.sort_order);

  const totalRuns = agentRuns.length;
  const totalRecords = agentRuns.reduce((s, r) => s + (r.records_processed ?? 0), 0);
  const totalCost = agentRuns.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const totalTokens = agentRuns.reduce(
    (s, r) => s + (r.tokens_input ?? 0) + (r.tokens_output ?? 0),
    0,
  );
  const hasActive = agentRuns.some((r) => isActiveStatus(r.status));

  const doRun = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await runAgentNow(agent.id);
      setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    });
  };

  const doToggle = () => {
    startTransition(async () => {
      await setAgentEnabled(agent.id, !agent.enabled);
    });
  };

  return (
    <Panel
      title={agent.name}
      description={agent.description ?? undefined}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={doToggle}
            disabled={pending}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition disabled:opacity-50 ${
              agent.enabled
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"
                : "bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200"
            }`}
          >
            {agent.enabled ? "Enabled" : "Disabled"}
          </button>
          <button
            type="button"
            onClick={doRun}
            disabled={pending || !agent.enabled || hasActive}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "Working…" : hasActive ? "Run in progress" : "▶ Run now"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {msg ? (
          <p
            className={`rounded-lg px-3 py-2 text-xs ${
              msg.ok
                ? "bg-emerald-50 text-emerald-700"
                : "bg-rose-50 text-rose-700"
            }`}
          >
            {msg.text}
          </p>
        ) : null}

        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Runs" value={totalRuns} />
          <StatCard label="Records" value={totalRecords.toLocaleString()} />
          <StatCard label="Tokens" value={fmtTokens(totalTokens)} />
          <StatCard label="Token cost" value={fmtCost(totalCost)} />
        </div>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-500">
          <span>
            Schedule:{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">
              {agent.schedule_cron ?? "—"}
            </code>{" "}
            ({agent.timezone})
          </span>
          <span>Last run: {timeAgo(agent.last_run_at)}</span>
          <span className="flex items-center gap-1.5">
            Last status: <StatusBadge status={agent.last_status} />
          </span>
        </div>

        {/* Report catalog */}
        {agentReports.length > 0 ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Reports ({agentReports.length})
            </h3>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {agentReports.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {r.name}
                    </span>
                    <ScopeBadge scope={r.scope} />
                  </div>
                  <span className="text-xs text-slate-400">
                    {r.target ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Recent runs */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Recent runs
          </h3>
          {agentRuns.length === 0 ? (
            <p className="text-sm text-slate-400">No runs yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Trigger</th>
                    <th className="px-3 py-2 font-medium">Target date</th>
                    <th className="px-3 py-2 font-medium">Started</th>
                    <th className="px-3 py-2 font-medium">Duration</th>
                    <th className="px-3 py-2 text-right font-medium">Records</th>
                    <th className="px-3 py-2 text-right font-medium">Tokens</th>
                    <th className="px-3 py-2 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {agentRuns.slice(0, 10).map((run) => (
                    <tr key={run.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2">
                        <StatusBadge status={run.status} />
                        {run.error ? (
                          <p className="mt-1 max-w-xs truncate text-[11px] text-rose-500" title={run.error}>
                            {run.error}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{run.trigger}</td>
                      <td className="px-3 py-2 text-slate-600">{run.target_date ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{timeAgo(run.started_at ?? run.created_at)}</td>
                      <td className="px-3 py-2 text-slate-600">{fmtDuration(run.duration_ms)}</td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {(run.records_processed ?? 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {fmtTokens((run.tokens_input ?? 0) + (run.tokens_output ?? 0))}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {fmtCost(Number(run.cost_usd ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

export function AgentsView({
  agents,
  reports,
  runs,
}: {
  agents: Agent[];
  reports: AgentReport[];
  runs: AgentRun[];
}) {
  if (agents.length === 0) {
    return (
      <Panel title="Agents" description="Automated data agents.">
        <p className="text-sm text-slate-400">
          No agents registered yet. Apply migration 0088 to seed the ezyVet daily
          ingest agent.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} reports={reports} runs={runs} />
      ))}
    </div>
  );
}
