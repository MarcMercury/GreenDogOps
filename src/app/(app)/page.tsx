import Link from "next/link";
import { PageHeader } from "./_components/ui";

const MODULE_CARDS = [
  {
    href: "/hr",
    title: "HR / Roster",
    desc: "Master employee records, payroll data, reviews, discipline, and provided items.",
    icon: "👥",
    accent: "from-emerald-500/10 to-emerald-500/0 text-emerald-700",
    dot: "bg-emerald-500",
  },
  {
    href: "/ats",
    title: "Recruiting (ATS)",
    desc: "Prospect profiles using the same template as employees. Hire with one status change.",
    icon: "🎯",
    accent: "from-blue-500/10 to-blue-500/0 text-blue-700",
    dot: "bg-blue-500",
  },
  {
    href: "/crm",
    title: "CRM / Contacts",
    desc: "Referring clinics, local businesses, facility and medical vendors.",
    icon: "🏢",
    accent: "from-violet-500/10 to-violet-500/0 text-violet-700",
    dot: "bg-violet-500",
  },
  {
    href: "/schedule",
    title: "Scheduling",
    desc: "Build and manage shifts across locations.",
    icon: "🗓️",
    accent: "from-amber-500/10 to-amber-500/0 text-amber-700",
    dot: "bg-amber-500",
  },
  {
    href: "/policies",
    title: "Policies",
    desc: "Searchable wiki of Green Dog policies, procedures, and internal admin documents.",
    icon: "📚",
    accent: "from-rose-500/10 to-rose-500/0 text-rose-700",
    dot: "bg-rose-500",
  },
  {
    href: "/admin",
    title: "Admin",
    desc: "Users, roles, permissions, and system settings.",
    icon: "⚙️",
    accent: "from-slate-500/10 to-slate-500/0 text-slate-700",
    dot: "bg-slate-500",
  },
] as const;

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Welcome to Green Dog Ops. Choose a module to get started."
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULE_CARDS.map((c) => (
          <Link
            key={c.href}
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
            <h2 className="relative mt-4 flex items-center gap-2 font-semibold text-slate-900">
              <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
              {c.title}
            </h2>
            <p className="relative mt-1.5 text-sm leading-relaxed text-slate-500">
              {c.desc}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
