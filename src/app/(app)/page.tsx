import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule, type ModuleKey } from "@/lib/auth/permissions";
import { loadDashboard } from "@/lib/worklist/sources";
import { workSummary } from "@/lib/worklist/items";
import { relativeDayLabel, shortDateLabel } from "@/lib/worklist/dates";
import { ActivityLog } from "./_components/activity-log";
import { PageHeader } from "./_components/ui";
import { buildActivityDays } from "./_work/activity";
import { WorkList } from "./_work/work-list";
import { RemindersPanel } from "./_work/reminders-panel";
import { NotificationsPanel } from "./_work/notifications-panel";
import { SlackPanel } from "./_work/slack-panel";

export const dynamic = "force-dynamic";

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hour12: false }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-sm">
      <p className={`text-xl font-bold tabular-nums ${value > 0 ? tone : "text-slate-300"}`}>{value}</p>
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
    </div>
  );
}

/**
 * Home page: the signed-in user's work center — tasks and items waiting on
 * them across Ops, recurring reminders, notifications, and what Ops has routed
 * to them in Slack. Data: src/lib/worklist/sources.ts.
 */
export default async function DashboardPage() {
  const current = await getCurrentUser();
  if (!current) return null;
  const user = current.appUser;

  const isVisible = (module: ModuleKey) => canAccessModule(user, module);
  const [data, activityDays] = await Promise.all([
    loadDashboard(user),
    buildActivityDays(isVisible, current.email),
  ]);

  const summary = workSummary(data.work, data.today);
  const remindersOpen = data.reminders.current.filter((r) => r.status !== "done").length;
  const firstName = (user.full_name ?? "").trim().split(/\s+/)[0] || null;
  const slackWorkCount = data.work.filter((i) => i.target === "slack").length;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={relativeDayLabel(data.today, data.today) + " · " + shortDateLabel(data.today)}
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        description="Your work, reminders and notifications across Green Dog Ops. Slack is for talking — this is where things get done."
      />

      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Overdue" value={summary.overdue} tone="text-rose-600" />
        <Stat label="Due today" value={summary.dueToday} tone="text-emerald-700" />
        <Stat label="Reminders" value={remindersOpen} tone="text-amber-600" />
        <Stat label="Unread" value={data.notifications.unread} tone="text-sky-700" />
      </div>

      {data.setupNeeded ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          Tasks, reminders and notifications are being set up (database migration 0230 hasn&apos;t been applied yet).
          Items from your modules still show below.
        </p>
      ) : null}
      {data.warnings.length > 0 ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-700">
          {data.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <WorkList
            items={data.work}
            today={data.today}
            meId={user.id}
            assignees={data.assignees}
            slackConnected={data.slack.link?.status === "connected"}
            canAddTasks={!data.setupNeeded}
          />

          {data.assignedByMe.length > 0 ? (
            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <header className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Assigned by you</h2>
                <p className="text-xs text-slate-500">Open tasks you gave to others. You&apos;ll be notified when they&apos;re done.</p>
              </header>
              <ul className="divide-y divide-slate-50">
                {data.assignedByMe.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span className="min-w-0 truncate text-slate-700">{t.title}</span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {t.assignee}
                      {t.due_date ? ` · ${relativeDayLabel(t.due_date, data.today)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Your activity</h2>
            <ActivityLog days={activityDays} />
          </section>
        </div>

        <aside className="space-y-5">
          <RemindersPanel current={data.reminders.current} upcoming={data.reminders.upcoming} today={data.today} />
          <NotificationsPanel items={data.notifications.items} unread={data.notifications.unread} />
          <SlackPanel
            slack={data.slack}
            slackWorkCount={slackWorkCount}
            hasPerson={!!user.person_id}
            dmLive={process.env.SLACK_DM_LIVE?.trim().toLowerCase() === "true"}
          />
        </aside>
      </div>

      <footer className="mt-12 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
        <Link href="/privacy" className="hover:text-slate-600">
          Privacy Policy
        </Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:text-slate-600">
          Terms of Service
        </Link>
      </footer>
    </div>
  );
}
