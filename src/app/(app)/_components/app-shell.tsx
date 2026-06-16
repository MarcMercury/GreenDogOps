"use client";

import { useEffect, useState } from "react";
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

function currentLabel(pathname: string): string {
  const match = [...MODULES]
    .filter((m) => isActive(pathname, m.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "Green Dog Ops";
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Modules
      </p>
      {MODULES.map((m) => {
        const active = isActive(pathname, m.href);
        return (
          <Link
            key={m.href}
            href={m.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition sm:py-2 ${
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
    </>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
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
  );
}

function UserFooter({ email }: { email: string | null }) {
  return (
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
  );
}

export function AppShell({
  email,
  children,
}: {
  email: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="flex min-h-screen">
      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={open}
          className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 active:bg-slate-200"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-slate-900">
          {currentLabel(pathname)}
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-sm shadow-sm shadow-emerald-600/30">
          🐾
        </span>
      </header>

      {/* Backdrop for mobile drawer */}
      {open ? (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      {/* Sidebar — drawer on mobile, static on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[82vw] shrink-0 flex-col border-r border-slate-200/80 bg-white shadow-xl transition-transform duration-300 ease-out lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:bg-white/80 lg:shadow-none lg:backdrop-blur-sm ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
          <Brand />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
            className="-mr-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 lg:hidden"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          <NavLinks onNavigate={() => setOpen(false)} />
        </nav>

        <UserFooter email={email} />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-x-hidden px-4 pb-10 pt-[4.5rem] sm:px-6 lg:px-10 lg:pb-10 lg:pt-8">
        {children}
      </main>
    </div>
  );
}
