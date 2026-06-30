import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule, type ModuleKey } from "@/lib/auth/permissions";
import { PageHeader } from "./_components/ui";

export const dynamic = "force-dynamic";

type Card = {
  href: string;
  title: string;
  desc: string;
  icon: string;
  accent: string;
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
        desc: "AI search across all program data and the web, plus the Green Dog policies wiki and shared document library.",
        icon: "📚",
        accent: "from-rose-500/10 to-rose-500/0 text-rose-700",
        dot: "bg-rose-500",
        module: "resources",
      },
      {
        href: "/hr",
        title: "HR / Roster",
        desc: "Master employee records: payroll, reviews, discipline, PTO, credentials, and provided items.",
        icon: "👥",
        accent: "from-emerald-500/10 to-emerald-500/0 text-emerald-700",
        dot: "bg-emerald-500",
        module: "hr",
      },
      {
        href: "/ats",
        title: "Recruiting (ATS)",
        desc: "Applicant pipeline with interview tracking. Hire a prospect with a single status change into HR.",
        icon: "🎯",
        accent: "from-blue-500/10 to-blue-500/0 text-blue-700",
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
        desc: "Referring medical clinics & hospitals, with geocoding and clinic-area mapping.",
        icon: "🏥",
        accent: "from-violet-500/10 to-violet-500/0 text-violet-700",
        dot: "bg-violet-500",
        module: "crm_referral",
      },
      {
        href: "/crm/vendor",
        title: "Vendor CRM",
        desc: "Med-ops, facility, and marketing/office vendors in one directory.",
        icon: "🔧",
        accent: "from-violet-500/10 to-violet-500/0 text-violet-700",
        dot: "bg-violet-500",
        module: "crm_vendor",
      },
      {
        href: "/crm/business",
        title: "Business CRM",
        desc: "Business & marketing partners and outreach opportunities.",
        icon: "🤝",
        accent: "from-violet-500/10 to-violet-500/0 text-violet-700",
        dot: "bg-violet-500",
        module: "crm_business",
      },
      {
        href: "/crm/student",
        title: "Student CRM",
        desc: "Students, externs, and program participants across the pipeline.",
        icon: "🎓",
        accent: "from-violet-500/10 to-violet-500/0 text-violet-700",
        dot: "bg-violet-500",
        module: "crm_student",
      },
      {
        href: "/crm/ce",
        title: "CE Leads",
        desc: "Continuing-education event attendees, outreach, and attendance tracking.",
        icon: "📋",
        accent: "from-violet-500/10 to-violet-500/0 text-violet-700",
        dot: "bg-violet-500",
        module: "crm_ce",
      },
      {
        href: "/crm/influencer",
        title: "Influencer CRM",
        desc: "Influencer partnerships, campaigns, and performance.",
        icon: "⭐",
        accent: "from-violet-500/10 to-violet-500/0 text-violet-700",
        dot: "bg-violet-500",
        module: "crm_influencer",
      },
      {
        href: "/ezyvet",
        title: "ezyVet CRM",
        desc: "Client contacts imported from ezyVet, with customer groups, revenue, and division trends.",
        icon: "🐾",
        accent: "from-teal-500/10 to-teal-500/0 text-teal-700",
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
        desc: "Build and manage shifts across locations, with attendance, time-off, and availability.",
        icon: "🗓️",
        accent: "from-amber-500/10 to-amber-500/0 text-amber-700",
        dot: "bg-amber-500",
        module: "schedule",
      },
      {
        href: "/capacity",
        title: "Daily Capacity",
        desc: "Live view of daily staffing capacity against demand across every service site.",
        icon: "📊",
        accent: "from-amber-500/10 to-amber-500/0 text-amber-700",
        dot: "bg-amber-500",
        module: "schedule",
      },
      {
        href: "/planning",
        title: "Planning Guides",
        desc: "Service-site staffing guides and signatures that drive capacity planning.",
        icon: "🧭",
        accent: "from-amber-500/10 to-amber-500/0 text-amber-700",
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
        desc: "Appointments, revenue, and client trends derived from ezyVet invoice and contact exports.",
        icon: "📈",
        accent: "from-indigo-500/10 to-indigo-500/0 text-indigo-700",
        dot: "bg-indigo-500",
        module: "reporting",
      },
      {
        href: "/emp-reporting",
        title: "Emp Reporting",
        desc: "Payroll and compensation analytics across the roster.",
        icon: "💰",
        accent: "from-indigo-500/10 to-indigo-500/0 text-indigo-700",
        dot: "bg-indigo-500",
        module: "emp_reporting",
      },
      {
        href: "/admin",
        title: "Admin",
        desc: "Users, roles, permissions, locations, credentials, settings, and the audit log.",
        icon: "⚙️",
        accent: "from-slate-500/10 to-slate-500/0 text-slate-700",
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
      className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300/70 hover:shadow-md hover:shadow-emerald-600/5"
    >
      <div
        className={`pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${c.accent} blur-2xl`}
      />
      <div className="relative flex items-start justify-between">
        <span
          className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-xl ring-1 ring-inset ring-slate-200/70 ${c.accent}`}
        >
          {c.icon}
        </span>
        <span className="text-slate-300 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-emerald-500">
          →
        </span>
      </div>
      <h3 className="relative mt-4 flex items-center gap-2 font-semibold text-slate-900">
        <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
        {c.title}
      </h3>
      <p className="relative mt-1.5 text-sm leading-relaxed text-slate-500">
        {c.desc}
      </p>
    </Link>
  );
}

export default async function DashboardPage() {
  const current = await getCurrentUser();

  const groups = current
    ? GROUPS.map((g) => ({
        title: g.title,
        cards: g.cards.filter((c) => canAccessModule(current.appUser, c.module)),
      })).filter((g) => g.cards.length > 0)
    : GROUPS;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Welcome to Green Dog Ops. Jump into any module below."
      />

      <div className="mt-8 space-y-10">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {g.title}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.cards.map((c) => (
                <ModuleCard key={c.href} c={c} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
