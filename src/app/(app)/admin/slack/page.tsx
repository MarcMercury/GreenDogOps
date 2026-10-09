import Link from "next/link";
import { requireAdminView } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSlackWorkspaceStatus } from "@/lib/slack/users";
import { slackLinkNeedsAttention } from "@/lib/slack/matching";
import {
  loadSlackAdminRows,
  SLACK_SYNC_AGENT_KEY,
  type SlackAdminRow,
} from "@/lib/slack/link-sync";
import { Panel, StatCard } from "../_components";
import { SlackLinksTable, SyncSlackButton } from "./slack-links-table";

export const dynamic = "force-dynamic";

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SlackAdminPage() {
  const current = await requireAdminView();
  const canEdit = isAdminRole(current.appUser.role);
  const admin = createAdminClient();

  const [workspace, rowsResult, agentRes] = await Promise.all([
    getSlackWorkspaceStatus(),
    loadSlackAdminRows().then(
      (rows) => ({ rows, error: null as string | null }),
      (err: unknown) => ({
        rows: [] as SlackAdminRow[],
        error: err instanceof Error ? err.message : String(err),
      }),
    ),
    admin
      .from("agent")
      .select("last_run_at, last_status")
      .eq("key", SLACK_SYNC_AGENT_KEY)
      .maybeSingle(),
  ]);
  const { rows, error: loadError } = rowsResult;
  const agent = agentRes.data as { last_run_at: string | null; last_status: string | null } | null;

  const connected = rows.filter((r) => r.link?.status === "connected").length;
  const attention = rows.filter((r) => slackLinkNeedsAttention(r.link?.status)).length;
  const disconnected = rows.filter((r) => r.link?.status === "disconnected").length;

  return (
    <div className="space-y-6">
      <Panel
        title="Slack workspace"
        description="Green Dog Ops messages people at their Slack user id. Email is only used to find it."
        actions={canEdit && workspace.ok ? <SyncSlackButton /> : null}
      >
        <div className="space-y-2 text-sm">
          {!workspace.configured ? (
            <p className="text-amber-700">
              🟡 Not configured — set <code>SLACK_BOT_TOKEN</code> in Vercel.
            </p>
          ) : workspace.error ? (
            <p className="text-rose-700">🔴 {workspace.error}</p>
          ) : (
            <p className="text-slate-700">
              {workspace.ok ? "🟢 Connected" : "🟡 Connected, but can't read users"} —{" "}
              <span className="font-medium">{workspace.team ?? "Slack"}</span>
              {workspace.url ? (
                <span className="text-slate-400"> ({workspace.url.replace(/^https?:\/\//, "").replace(/\/$/, "")})</span>
              ) : null}
            </p>
          )}
          {workspace.missingScopes.length > 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              The Slack app is missing{" "}
              {workspace.missingScopes.map((s, i) => (
                <span key={s}>
                  {i > 0 ? " and " : ""}
                  <code>{s}</code>
                </span>
              ))}
              . In the Slack app settings, add them under <em>OAuth &amp; Permissions → Bot Token
              Scopes</em>, reinstall the app, and update <code>SLACK_BOT_TOKEN</code> in Vercel if
              it changed.
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            Nightly sync: last run {when(agent?.last_run_at ?? null)}
            {agent?.last_status ? ` (${agent.last_status})` : ""} ·{" "}
            <Link href="/admin/agents" className="text-emerald-700 hover:underline">
              history
            </Link>
          </p>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active staff" value={rows.length} sublabel="employees + contractors" />
        <StatCard label="Connected" value={connected} icon="🟢" />
        <StatCard label="Need attention" value={attention} icon="⚠️" />
        <StatCard label="Disconnected" value={disconnected} sublabel="unlinked by an admin" />
      </div>

      <Panel
        title="People"
        description="Matched by exact email (HR email or login email). Anyone else needs a manual link — the sync never matches by name."
      >
        {loadError ? (
          <p className="text-sm text-rose-700">Could not load Slack links: {loadError}</p>
        ) : (
          <SlackLinksTable rows={rows} canEdit={canEdit} canSearch={workspace.ok} />
        )}
      </Panel>
    </div>
  );
}
