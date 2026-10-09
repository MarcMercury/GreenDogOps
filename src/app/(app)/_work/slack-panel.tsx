import type { DashboardData } from "@/lib/worklist/sources";
import { slackClientUrl } from "@/lib/worklist/items";

const STATUS_CHIP: Record<string, { label: string; tone: string }> = {
  sent: { label: "Sent", tone: "bg-emerald-100 text-emerald-700" },
  pending: { label: "Queued", tone: "bg-sky-100 text-sky-700" },
  sending: { label: "Sending", tone: "bg-sky-100 text-sky-700" },
  failed: { label: "Failed", tone: "bg-rose-100 text-rose-700" },
  skipped: { label: "Not sent", tone: "bg-slate-100 text-slate-500" },
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * What Ops has routed to this user in Slack. Ops does not read anyone's Slack
 * messages (the app has no *:history scopes) — message summaries are a later
 * phase that needs per-user "Connect Slack" consent.
 */
export function SlackPanel({
  slack,
  slackWorkCount,
  hasPerson,
  dmLive,
}: {
  slack: DashboardData["slack"];
  slackWorkCount: number;
  hasPerson: boolean;
  dmLive: boolean;
}) {
  const connected = slack.link?.status === "connected";
  const team = slack.link?.slack_team_id ?? null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Slack</h2>
          <p className="text-xs text-slate-500">Talk in Slack; act in Ops.</p>
        </div>
        <a
          href={slackClientUrl(team)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100"
        >
          Open Slack ↗
        </a>
      </header>

      <div className="space-y-3 px-4 py-3 text-xs">
        <p className="text-slate-600">
          {connected ? (
            <>🟢 Your Slack account is connected — Ops can DM you{dmLive ? "" : " (DMs are still in testing)"}.</>
          ) : !hasPerson ? (
            <>⚪ Your login isn&apos;t linked to an employee profile, so Ops can&apos;t reach you in Slack.</>
          ) : (
            <>🟡 Your Slack account isn&apos;t linked yet. An admin can connect it in Admin ▸ Slack.</>
          )}
        </p>

        {slackWorkCount > 0 ? (
          <p className="rounded-lg bg-violet-50 px-3 py-2 text-violet-800">
            💬 {slackWorkCount} item{slackWorkCount === 1 ? "" : "s"} on your work list {slackWorkCount === 1 ? "is" : "are"} done in Slack —
            filter <span className="font-semibold">In Slack</span>.
          </p>
        ) : null}

        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sent to you in Slack</p>
          {slack.deliveries.length === 0 ? (
            <p className="text-slate-400">Nothing yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {slack.deliveries.map((d) => {
                const chip = STATUS_CHIP[d.status] ?? STATUS_CHIP.skipped;
                return (
                  <li key={d.id} className="flex items-start gap-2">
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${chip.tone}`}>{chip.label}</span>
                    <div className="min-w-0 flex-1">
                      {d.status === "sent" && d.slack_channel_id ? (
                        <a
                          href={slackClientUrl(team, d.slack_channel_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-700 hover:underline"
                        >
                          {d.title}
                        </a>
                      ) : (
                        <p className="text-slate-700">{d.title}</p>
                      )}
                      <p className="text-[11px] text-slate-400">
                        {when(d.sent_at ?? d.created_at)}
                        {d.status === "failed" || d.status === "skipped" ? ` · ${d.last_error ?? ""}` : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-slate-500">
          <p className="font-medium text-slate-600">Message summaries — coming later</p>
          <p>
            A summary of your unread Slack mentions and DMs will appear here once Slack read access is approved and you
            connect your own Slack account. Ops doesn&apos;t read Slack messages today.
          </p>
        </div>
      </div>
    </section>
  );
}
