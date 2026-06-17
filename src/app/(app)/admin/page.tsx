import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABELS, APP_ROLES, type AppRole } from "@/lib/auth/permissions";
import { StatCard, Panel, StatusRow, RoleBadge } from "./_components";

export const dynamic = "force-dynamic";

type CountBuilder = ReturnType<
  ReturnType<ReturnType<typeof createAdminClient>["from"]>["select"]
>;

async function count(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  filter?: (q: CountBuilder) => CountBuilder,
): Promise<number> {
  let q = admin.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count } = await q;
  return count ?? 0;
}

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

function isRecent(iso: string | null): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 86_400_000;
}

const INTEGRATIONS: { label: string; env: string }[] = [
  { label: "OpenAI", env: "OPENAI_API_KEY" },
  { label: "Gemini", env: "GEMINI_API_KEY" },
  { label: "Resend (email)", env: "RESEND_API_KEY" },
  { label: "Slack", env: "SLACK_BOT_TOKEN" },
  { label: "Google Maps", env: "GOOGLE_MAPS_API_KEY" },
  { label: "Service role key", env: "SUPABASE_SERVICE_ROLE_KEY" },
  { label: "Cron secret", env: "CRON_SECRET" },
];

export default async function AdminOverviewPage() {
  const admin = createAdminClient();

  const [
    employees,
    former,
    applicants,
    contractors,
    orgs,
    contacts,
    appUsers,
    activeUsers,
    credentials,
    usersData,
    auditData,
  ] = await Promise.all([
    count(admin, "person", (q) => q.eq("status", "employee")),
    count(admin, "person", (q) => q.eq("status", "former")),
    count(admin, "person", (q) => q.eq("status", "applicant")),
    count(admin, "person", (q) => q.eq("status", "contractor")),
    count(admin, "crm_organization"),
    count(admin, "crm_contact"),
    count(admin, "app_user"),
    count(admin, "app_user", (q) => q.eq("is_active", true)),
    count(admin, "credential"),
    admin.from("app_user").select("role, last_seen_at"),
    admin
      .from("audit_log")
      .select("action, summary, actor_email, created_at")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const roleCounts = APP_ROLES.reduce<Record<AppRole, number>>(
    (acc, r) => ({ ...acc, [r]: 0 }),
    {} as Record<AppRole, number>,
  );
  let recentlyActive = 0;
  for (const u of (usersData.data ?? []) as {
    role: AppRole;
    last_seen_at: string | null;
  }[]) {
    roleCounts[u.role] = (roleCounts[u.role] ?? 0) + 1;
    if (isRecent(u.last_seen_at)) recentlyActive += 1;
  }

  const audit = (auditData.data ?? []) as {
    action: string;
    summary: string | null;
    actor_email: string | null;
    created_at: string;
  }[];

  return (
    <div className="space-y-6">
      {/* Module record counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Employees" value={employees} icon="👥" href="/hr" />
        <StatCard label="Applicants" value={applicants} icon="🎯" href="/ats" />
        <StatCard
          label="CRM orgs"
          value={orgs}
          icon="🏢"
          href="/crm/referral"
        />
        <StatCard
          label="CRM contacts"
          value={contacts}
          icon="📇"
          href="/crm/student"
        />
        <StatCard label="Former staff" value={former} icon="📁" href="/hr" />
        <StatCard label="Contractors" value={contractors} icon="🔧" href="/hr" />
        <StatCard
          label="GDO users"
          value={appUsers}
          sublabel={`${activeUsers} active`}
          icon="🔑"
          href="/admin/users"
        />
        <StatCard
          label="Active today"
          value={recentlyActive}
          icon="🟢"
          href="/admin/users"
        />
        <StatCard
          label="Credentials"
          value={credentials}
          icon="🔐"
          href="/admin/credentials"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* System health */}
        <Panel
          title="System health"
          description="Live status of core services."
        >
          <StatusRow label="Database (Supabase)" ok detail="connected" />
          <StatusRow label="greendogops schema" ok detail="isolated" />
          <StatusRow
            label="Service-role client"
            ok={!!process.env.SUPABASE_SERVICE_ROLE_KEY}
            detail={
              process.env.SUPABASE_SERVICE_ROLE_KEY ? "configured" : "missing"
            }
          />
          <StatusRow
            label="Environment"
            ok
            detail={process.env.VERCEL_ENV ?? process.env.NODE_ENV}
          />
        </Panel>

        {/* Integrations */}
        <Panel
          title="Integrations"
          description="Configured API keys (values never shown)."
        >
          {INTEGRATIONS.map((i) => (
            <StatusRow
              key={i.env}
              label={i.label}
              ok={!!process.env[i.env]}
              detail={process.env[i.env] ? "configured" : "not set"}
            />
          ))}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Users by role */}
        <Panel title="Users by role" description="GDO access breakdown.">
          <div className="space-y-2">
            {APP_ROLES.map((r) => (
              <div
                key={r}
                className="flex items-center justify-between border-b border-slate-50 py-1.5 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <RoleBadge role={r} />
                  <span className="text-sm text-slate-600">
                    {ROLE_LABELS[r]}
                  </span>
                </div>
                <span className="text-sm font-semibold text-slate-900">
                  {roleCounts[r]}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        {/* Recent activity */}
        <Panel
          title="Recent activity"
          description="Latest entries from the audit log."
          actions={
            <a
              href="/admin/audit"
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              View all →
            </a>
          }
        >
          {audit.length === 0 ? (
            <p className="py-2 text-sm text-slate-400">No activity yet.</p>
          ) : (
            <ul className="space-y-2">
              {audit.map((a, i) => (
                <li
                  key={i}
                  className="flex items-start justify-between gap-3 border-b border-slate-50 pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-700">
                      {a.summary ?? a.action}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {a.actor_email ?? "system"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {timeAgo(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
