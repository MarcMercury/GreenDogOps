import { requireAdminView } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";
import { loadNotificationAdmin } from "@/lib/notify/admin";
import { EVENT_GROUPS } from "@/lib/notify/registry";
import { Panel, StatCard } from "../_components";
import { DeliveryLog, NotificationRules, ProcessQueueButton } from "./notification-admin";

export const dynamic = "force-dynamic";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function NotificationsAdminPage() {
  const current = await requireAdminView();
  const canEdit = isAdminRole(current.appUser.role);
  const data = await loadNotificationAdmin();

  const dmLive = process.env.SLACK_DM_LIVE?.trim().toLowerCase() === "true";
  const testIds = (process.env.SLACK_DM_TEST_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const interactive = Boolean(process.env.SLACK_SIGNING_SECRET);
  const botToken = Boolean(process.env.SLACK_BOT_TOKEN);
  const connected = data.people.filter((p) => p.hasSlack).length;

  return (
    <div className="space-y-6">
      <Panel
        title="Slack delivery"
        description="Ops events are routed to people by the rules below, then delivered as Slack DMs (and channel posts) plus the in-app inbox."
        actions={canEdit ? <ProcessQueueButton /> : null}
      >
        <ul className="space-y-1.5 text-sm">
          <li>
            {botToken ? "🟢" : "🔴"} Slack bot token {botToken ? "configured" : <>missing — set <code>SLACK_BOT_TOKEN</code></>}
          </li>
          <li>
            {dmLive ? (
              "🟢 Direct messages are live for everyone."
            ) : (
              <>
                🟡 Direct messages are in test mode
                {testIds.length ? ` (only ${testIds.length} test user${testIds.length === 1 ? "" : "s"})` : " (nobody receives them)"}
                . Set <code>SLACK_DM_LIVE=true</code> in Vercel to go live. Channel posts and the in-app inbox work either way.
              </>
            )}
          </li>
          <li>
            {interactive ? "🟢" : "🟡"} Slack buttons (Approve / Deny / Acknowledge / Mark complete){" "}
            {interactive ? (
              "are on."
            ) : (
              <>
                are off — set <code>SLACK_SIGNING_SECRET</code> and turn on Interactivity in the Slack app with the
                request URL <code>/api/slack/interactions</code>.
              </>
            )}
          </li>
          <li>
            🔗 {connected} of {data.people.length} active staff have a connected Slack account (Admin ▸ Slack).
          </li>
        </ul>
      </Panel>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Sent (7 days)" value={data.stats.sent} icon="✅" />
        <StatCard label="Waiting" value={data.stats.pending} sublabel="incl. batched" />
        <StatCard label="Skipped" value={data.stats.skipped} sublabel="see reasons below" />
        <StatCard label="Failed" value={data.stats.failed} icon={data.stats.failed ? "⚠️" : undefined} />
        <StatCard label="Events (7 days)" value={data.stats.events} sublabel={data.stats.failedEvents ? `${data.stats.failedEvents} failed` : undefined} />
      </div>

      <Panel
        title="Notification rules"
        description="Defaults work out of the box. Change who receives each notification, how it's delivered, batching and escalation — no code changes needed."
      >
        <NotificationRules
          rules={data.rules}
          groups={EVENT_GROUPS}
          people={data.people}
          departments={data.departments}
          canEdit={canEdit}
        />
      </Panel>

      <Panel title="Delivery log" description="The last 200 Slack deliveries. A message is marked sent only after Slack accepts it.">
        <DeliveryLog deliveries={data.deliveries} canEdit={canEdit} />
      </Panel>

      <Panel title="Actions taken in Slack" description="Every button click, who made it and what happened.">
        {data.actions.length === 0 ? (
          <p className="text-sm text-slate-500">No Slack actions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Who</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Outcome</th>
                  <th className="py-2">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.actions.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap py-2 pr-4 text-slate-500">{when(a.createdAt)}</td>
                    <td className="py-2 pr-4">{a.actor}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{a.action}</td>
                    <td className="py-2 pr-4">{a.outcome.replace(/_/g, " ")}</td>
                    <td className="py-2 text-slate-500">{a.detail ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
