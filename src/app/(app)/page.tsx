import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import {
  canAccessModule,
  MODULES,
  type ModuleKey,
} from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "./_components/ui";
import {
  ActivityLog,
  type ActivityDay,
  type ActivityItem,
} from "./_components/activity-log";

export const dynamic = "force-dynamic";

type Card = {
  href: string;
  title: string;
  desc: string;
  icon: string;
  dot: string;
  /** Module key used to decide whether this card is visible for the user. */
  module: ModuleKey;
};

type Group = { title: string; cards: Card[] };

// ---------------------------------------------------------------------------
// Dashboard catalog — mirrors the sidebar navigation so the home page stays in
// sync with every module the app ships. Each card is gated by a ModuleKey and
// only rendered when the signed-in user can access that module.
// ---------------------------------------------------------------------------
const GROUPS: Group[] = [
  {
    title: "Modules",
    cards: [
      {
        href: "/resources",
        title: "Resources",
        desc: "AI search, policies wiki & shared document library.",
        icon: "📚",
        dot: "bg-rose-500",
        module: "resources",
      },
      {
        href: "/hr",
        title: "HR / Roster",
        desc: "Employee records: payroll, reviews, PTO & credentials.",
        icon: "👥",
        dot: "bg-emerald-500",
        module: "hr",
      },
      {
        href: "/ats",
        title: "Recruiting (ATS)",
        desc: "Applicant pipeline with interview tracking.",
        icon: "🎯",
        dot: "bg-blue-500",
        module: "ats",
      },
    ],
  },
  {
    title: "CRM",
    cards: [
      {
        href: "/crm/referral",
        title: "Referral CRM",
        desc: "Referring clinics & hospitals with clinic-area mapping.",
        icon: "🏥",
        dot: "bg-violet-500",
        module: "crm_referral",
      },
      {
        href: "/crm/vendor",
        title: "Vendor & Partner CRM",
        desc: "Vendors, suppliers & business partners.",
        icon: "🤝",
        dot: "bg-violet-500",
        module: "crm_vendor",
      },
      {
        href: "/crm/student",
        title: "Student CRM",
        desc: "Students, externs & program participants.",
        icon: "🎓",
        dot: "bg-violet-500",
        module: "crm_student",
      },
      {
        href: "/crm/ce",
        title: "CE Leads",
        desc: "CE event attendees, outreach & attendance.",
        icon: "📋",
        dot: "bg-violet-500",
        module: "crm_ce",
      },
      {
        href: "/crm/influencer",
        title: "Influencer CRM",
        desc: "Influencer partnerships & campaigns.",
        icon: "⭐",
        dot: "bg-violet-500",
        module: "crm_influencer",
      },
      {
        href: "/ezyvet",
        title: "ezyVet CRM",
        desc: "Client contacts, customer groups & revenue trends.",
        icon: "🐾",
        dot: "bg-teal-500",
        module: "ezyvet",
      },
    ],
  },
  {
    title: "Operations",
    cards: [
      {
        href: "/schedule",
        title: "Scheduling",
        desc: "Shifts, attendance, time-off & availability.",
        icon: "🗓️",
        dot: "bg-amber-500",
        module: "schedule",
      },
      {
        href: "/capacity",
        title: "Daily Capacity",
        desc: "Live staffing capacity vs. demand by site.",
        icon: "📊",
        dot: "bg-amber-500",
        module: "schedule",
      },
      {
        href: "/planning",
        title: "Planning Guides",
        desc: "Service-site staffing guides & signatures.",
        icon: "🧭",
        dot: "bg-amber-500",
        module: "planning",
      },
    ],
  },
  {
    title: "Biz Dev",
    cards: [
      {
        href: "/reporting",
        title: "Reporting",
        desc: "Appointments, revenue & client trends.",
        icon: "📈",
        dot: "bg-indigo-500",
        module: "reporting",
      },
      {
        href: "/emp-reporting",
        title: "Emp Reporting",
        desc: "Payroll & compensation analytics.",
        icon: "💰",
        dot: "bg-indigo-500",
        module: "emp_reporting",
      },
      {
        href: "/admin",
        title: "Admin",
        desc: "Users, roles, locations, settings & audit log.",
        icon: "⚙️",
        dot: "bg-slate-500",
        module: "admin",
      },
    ],
  },
];

function ModuleCard({ c }: { c: Card }) {
  return (
    <Link
      href={c.href}
      className="group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2.5 shadow-sm backdrop-blur-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300/70 hover:shadow-md hover:shadow-emerald-600/5"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-lg ring-1 ring-inset ring-slate-200/70">
        {c.icon}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} />
          {c.title}
        </h3>
        <p className="truncate text-xs leading-relaxed text-slate-500">
          {c.desc}
        </p>
      </div>
      <span className="shrink-0 text-slate-300 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-emerald-500">
        →
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Activity feed — the audit_log powers a program-wide log. Each entry is
// mapped to a module so it is only shown to users who can access that module.
// ---------------------------------------------------------------------------
const TZ = "America/Los_Angeles";

const MODULE_ICONS: Record<ModuleKey, string> = {
  dashboard: "🏠",
  hr: "👥",
  ats: "🎯",
  crm_referral: "🏥",
  crm_vendor: "🤝",
  crm_business: "🤝",
  crm_student: "🎓",
  crm_ce: "📋",
  crm_influencer: "⭐",
  reporting: "📈",
  emp_reporting: "💰",
  ezyvet: "🐾",
  planning: "🧭",
  schedule: "🗓️",
  calendar: "📅",
  resources: "📚",
  admin: "⚙️",
};

const MODULE_LABELS = MODULES.reduce(
  (acc, m) => ({ ...acc, [m.key]: m.label }),
  {} as Record<ModuleKey, string>,
);

const MODULE_HREFS = MODULES.reduce(
  (acc, m) => ({ ...acc, [m.key]: m.href }),
  {} as Record<ModuleKey, string>,
);

/** Map an audit entry to the module it belongs to (for access filtering). */
function moduleForActivity(action: string, entity: string | null): ModuleKey {
  const a = action.toLowerCase();
  const e = (entity ?? "").toLowerCase();

  if (a.startsWith("referral.")) return "crm_referral";
  if (a.startsWith("influencer")) return "crm_influencer";
  if (a.startsWith("student")) return "crm_student";
  if (a.startsWith("ce.")) return "crm_ce";
  if (a.startsWith("vendor")) return "crm_vendor";
  if (a.startsWith("resource.")) return "resources";
  if (a.startsWith("ats.")) return "ats";
  if (a.startsWith("hr.")) return "hr";
  if (a.startsWith("schedule.")) return "schedule";
  if (a.startsWith("planning.")) return "planning";
  if (
    a.startsWith("user.") ||
    a.startsWith("settings.") ||
    a.startsWith("credential.") ||
    a.startsWith("location.")
  ) {
    return "admin";
  }

  switch (e) {
    case "referral_partner":
      return "crm_referral";
    case "influencer":
      return "crm_influencer";
    case "resource_category":
    case "resource_document":
      return "resources";
    case "person":
      return "ats";
    case "contact":
      return "crm_student";
    case "credential":
    case "app_user":
    case "app_setting":
    case "location":
    case "organization":
      return "admin";
    default:
      return "admin";
  }
}

/** Turn an action slug into readable text when no summary was stored. */
function prettifyAction(action: string): string {
  const words = action.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function dayKey(iso: string): string {
  // en-CA yields YYYY-MM-DD, which sorts lexicographically.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function dayLabel(key: string, todayKey: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const base = date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (key === todayKey) {
    return `Today · ${date.toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    })}`;
  }
  return `${base}, ${y}`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

async function buildActivityDays(
  isVisible: (module: ModuleKey) => boolean,
): Promise<ActivityDay[]> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("audit_log")
    .select("id, action, entity, summary, actor_email, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = (data ?? []) as {
    id: string;
    action: string;
    entity: string | null;
    summary: string | null;
    actor_email: string | null;
    created_at: string;
  }[];

  const todayKey = dayKey(new Date().toISOString());
  const byDay = new Map<string, ActivityItem[]>();
  // Always show today, even when nothing has happened yet.
  byDay.set(todayKey, []);

  for (const r of rows) {
    const moduleKey = moduleForActivity(r.action, r.entity);
    if (!isVisible(moduleKey)) continue;

    const item: ActivityItem = {
      id: r.id,
      time: timeLabel(r.created_at),
      actor: r.actor_email ?? "system",
      moduleLabel: MODULE_LABELS[moduleKey] ?? moduleKey,
      moduleIcon: MODULE_ICONS[moduleKey] ?? "•",
      moduleHref: MODULE_HREFS[moduleKey] ?? "/",
      summary: r.summary?.trim() || prettifyAction(r.action),
    };

    const key = dayKey(r.created_at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(item);
    else byDay.set(key, [item]);
  }

  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest day first
    .map(([key, items]) => ({
      key,
      label: dayLabel(key, todayKey),
      items,
    }));
}

export default async function DashboardPage() {
  const current = await getCurrentUser();

  const isVisible = (module: ModuleKey) =>
    current ? canAccessModule(current.appUser, module) : false;

  const groups = current
    ? GROUPS.map((g) => ({
        title: g.title,
        cards: g.cards.filter((c) => canAccessModule(current.appUser, c.module)),
      })).filter((g) => g.cards.length > 0)
    : GROUPS;

  const activityDays = current ? await buildActivityDays(isVisible) : [];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Quick links to every module, plus a live log of activity across the program."
      />

      {/* Condensed quick links */}
      <div className="mt-6 space-y-6">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {g.title}
            </h2>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {g.cards.map((c) => (
                <ModuleCard key={c.href} c={c} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Program-wide activity log */}
      {current ? (
        <section className="mt-10">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Activity Log
          </h2>
          <ActivityLog days={activityDays} />
        </section>
      ) : null}
    </div>
  );
}
