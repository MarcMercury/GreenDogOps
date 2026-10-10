import { Panel } from "../_components";
import type { Agent, AgentRun } from "@/lib/admin/agents";
import {
  agentHealth,
  ERROR_CATEGORY_LABELS,
  formatMinutes,
  HEALTH_LABELS,
  needsAttention,
  type AgentHealth,
  type HealthState,
} from "@/lib/admin/health";

const STATE_STYLE: Record<HealthState, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  stale: "bg-orange-50 text-orange-700 ring-orange-200",
  failing: "bg-rose-50 text-rose-700 ring-rose-200",
  stuck: "bg-rose-50 text-rose-700 ring-rose-200",
  never_run: "bg-slate-100 text-slate-500 ring-slate-200",
  disabled: "bg-slate-100 text-slate-400 ring-slate-200",
};

const STATE_ORDER: Record<HealthState, number> = {
  stuck: 0,
  failing: 1,
  stale: 2,
  warning: 3,
  never_run: 4,
  ok: 5,
  disabled: 6,
};

/** The page is force-dynamic, so this is the time of the request. */
function renderTime(): Date {
  return new Date();
}

function runsOn(agent: Agent): string {
  const runner = (agent.config ?? {}).runner;
  if (runner === "vercel_cron") return "Vercel cron";
  if (runner === "inline") return "In the app";
  return "Browser worker";
}

/**
 * One row per scheduled job: is it healthy, when did it last succeed, and if
 * not, roughly why. Health rules live in src/lib/admin/health.ts.
 */
export function HealthPanel({ agents, runs }: { agents: Agent[]; runs: AgentRun[] }) {
  const now = renderTime();
  const latestByAgent = new Map<string, AgentRun>();
  for (const r of runs) {
    const prev = latestByAgent.get(r.agent_id);
    if (!prev || r.created_at > prev.created_at) latestByAgent.set(r.agent_id, r);
  }

  const rows: { agent: Agent; health: AgentHealth }[] = agents
    .map((agent) => ({ agent, health: agentHealth(agent, latestByAgent.get(agent.id) ?? null, now) }))
    .sort(
      (a, b) =>
        STATE_ORDER[a.health.state] - STATE_ORDER[b.health.state] || a.agent.name.localeCompare(b.agent.name),
    );
  const attention = rows.filter((r) => needsAttention(r.agent, r.health)).length;

  return (
    <Panel
      title="Scheduled job health"
      description={
        attention > 0
          ? `${attention} job${attention === 1 ? " needs" : "s need"} attention. Failing, stale and stuck jobs also appear on admins' dashboards.`
          : "Every scheduled job: last success, failures in a row, and the likely cause of the latest error."
      }
    >
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium">Health</th>
              <th className="px-3 py-2 font-medium">Last success</th>
              <th className="px-3 py-2 text-right font-medium">Failures in a row</th>
              <th className="px-3 py-2 font-medium">Cause</th>
              <th className="px-3 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ agent, health }) => (
              <tr key={agent.id} className="border-b border-slate-50 align-top last:border-0">
                <td className="px-3 py-2">
                  <p className="font-medium text-slate-800">{agent.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {runsOn(agent)} · <code>{agent.schedule_cron ?? "—"}</code>
                    {agent.schedule_cron ? ` ${agent.timezone === "UTC" ? "UTC" : "PT"}` : ""}
                  </p>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${STATE_STYLE[health.state]}`}
                  >
                    {HEALTH_LABELS[health.state]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                  {health.minutesSinceSuccess == null ? "—" : `${formatMinutes(health.minutesSinceSuccess)} ago`}
                  {health.staleAfterMinutes ? (
                    <span className="block text-[11px] text-slate-400">
                      expected every {formatMinutes(health.staleAfterMinutes)}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right text-slate-600">{agent.consecutive_failures ?? 0}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                  {health.category ? ERROR_CATEGORY_LABELS[health.category] : "—"}
                </td>
                <td className="max-w-md px-3 py-2 text-xs text-slate-500">
                  <span className="line-clamp-2 break-words" title={health.summary}>
                    {health.summary}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
