const MODULE_CARDS = [
  {
    href: "/hr",
    title: "HR / Roster",
    desc: "Master employee records, payroll data, reviews, discipline, and provided items.",
  },
  {
    href: "/ats",
    title: "Recruiting (ATS)",
    desc: "Prospect profiles using the same template as employees. Hire with one status change.",
  },
  {
    href: "/crm",
    title: "CRM / Contacts",
    desc: "Referring clinics, local businesses, facility and medical vendors.",
  },
  {
    href: "/schedule",
    title: "Scheduling",
    desc: "Build and manage shifts across locations.",
  },
  {
    href: "/policies",
    title: "Policies",
    desc: "Searchable wiki of Green Dog policies, procedures, and internal admin documents.",
  },
  {
    href: "/admin",
    title: "Admin",
    desc: "Users, roles, permissions, and system settings.",
  },
] as const;

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">
        Welcome to Green Dog Ops. Choose a module to get started.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULE_CARDS.map((c) => (
          <a
            key={c.href}
            href={c.href}
            className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-emerald-300 hover:shadow-sm"
          >
            <h2 className="font-semibold text-slate-900">{c.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{c.desc}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
