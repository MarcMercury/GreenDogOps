"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Modules of Green Dog Ops. Visibility will later be gated by permissions. */
const MODULES = [
  { href: "/", label: "Dashboard", icon: "▣" },
  { href: "/hr", label: "HR / Roster", icon: "👥" },
  { href: "/ats", label: "Recruiting (ATS)", icon: "🎯" },
  { href: "/crm", label: "CRM / Contacts", icon: "🏢" },
  { href: "/schedule", label: "Scheduling", icon: "🗓️" },
  { href: "/policies", label: "Policies", icon: "📚" },
  { href: "/admin", label: "Admin", icon: "⚙️" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ email }: { email: string | null }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white/80 backdrop-blur-sm">
      <div className="flex items-center gap-3 border-b border-slate-200/80 px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-base font-bold text-white shadow-sm shadow-emerald-600/30">
          🐾
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[15px] font-bold tracking-tight text-slate-900">
            Green Dog Ops
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-emerald-600">
            Operations
          </span>
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Modules
        </p>
        {MODULES.map((m) => {
          const active = isActive(pathname, m.href);
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span
                className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-emerald-600 transition-opacity ${
                  active ? "opacity-100" : "opacity-0"
                }`}
                aria-hidden
              />
              <span
                className={`text-base transition-transform group-hover:scale-110 ${
                  active ? "" : "grayscale-[0.2]"
                }`}
                aria-hidden
              >
                {m.icon}
              </span>
              {m.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200/80 p-3">
        <div className="mb-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold uppercase text-slate-500">
            {(email ?? "?").charAt(0)}
          </span>
          <p
            className="min-w-0 flex-1 truncate text-xs text-slate-500"
            title={email ?? ""}
          >
            {email}
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
