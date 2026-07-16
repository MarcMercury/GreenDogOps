"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CRM_SECTIONS } from "@/lib/crm/types";
import type { AppRole, ModuleKey } from "@/lib/auth/permissions";
import { ROLE_LABELS } from "@/lib/auth/permissions";

type NavItem = { key: ModuleKey; href: string; label: string; icon: string };

// Desktop sidebar collapsed preference, persisted in localStorage and read via
// useSyncExternalStore so it stays in sync without a setState-in-effect.
const SIDEBAR_KEY = "gdo:sidebar-collapsed";
const SIDEBAR_EVENT = "gdo:sidebar-collapsed-change";

function subscribeSidebar(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(SIDEBAR_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SIDEBAR_EVENT, onChange);
  };
}

function getSidebarCollapsed(): boolean {
  return window.localStorage.getItem(SIDEBAR_KEY) === "1";
}

function setSidebarCollapsed(value: boolean): void {
  window.localStorage.setItem(SIDEBAR_KEY, value ? "1" : "0");
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}

const crmSection = (slug: string): NavItem => {
  const s = CRM_SECTIONS.find((sec) => sec.slug === slug);
  return {
    key: `crm_${slug}` as ModuleKey,
    href: `/crm/${slug}`,
    label: s?.label ?? slug,
    icon: s?.icon ?? "🏢",
  };
};

/** Top-level modules of Green Dog Ops. */
const MODULES_TOP: NavItem[] = [
  { key: "dashboard", href: "/", label: "Dashboard", icon: "▣" },
  { key: "resources", href: "/resources", label: "Resources", icon: "📚" },
];

/** HR, recruiting & Green Dog University. */
const HR_RECRUIT: NavItem[] = [
  { key: "hr", href: "/hr", label: "HR / Roster", icon: "👥" },
  { key: "ats", href: "/ats", label: "Recruiting (ATS)", icon: "🎯" },
  crmSection("student"),
];

/** Marketing CRMs. */
const MARKETING: NavItem[] = [
  crmSection("ce"),
  crmSection("influencer"),
  crmSection("referral"),
  crmSection("vendor"),
];

/** Operations modules. */
const MODULES_BOTTOM: NavItem[] = [
  { key: "calendar", href: "/calendar", label: "Calendar", icon: "📅" },
  { key: "schedule", href: "/schedule", label: "Scheduling", icon: "🗓️" },
  { key: "schedule", href: "/capacity", label: "Daily Capacity", icon: "📊" },
  { key: "planning", href: "/planning", label: "Planning Guides", icon: "🧭" },
];

/** Business development modules, after Operations. */
const BIZ_DEV: NavItem[] = [
  { key: "ezyvet", href: "/ezyvet", label: "ezyVet CRM", icon: "🐾" },
  { key: "reporting", href: "/reporting", label: "Reporting", icon: "📈" },
  { key: "emp_reporting", href: "/emp-reporting", label: "Emp Reporting", icon: "💰" },
  { key: "admin", href: "/admin", label: "Admin", icon: "⚙️" },
];

const ALL_NAV: Array<{ href: string; label: string; icon: string }> = [
  ...MODULES_TOP,
  ...HR_RECRUIT,
  { href: "/crm", label: "CRM", icon: "🏢" },
  ...MARKETING,
  ...MODULES_BOTTOM,
  ...BIZ_DEV,
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function currentLabel(pathname: string): string {
  const match = [...ALL_NAV]
    .filter((m) => isActive(pathname, m.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "Green Dog Ops";
}

function NavLink({
  item,
  onNavigate,
  collapsed,
}: {
  item: NavItem;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition sm:py-2 ${
        collapsed ? "lg:justify-center lg:px-2" : ""
      } ${
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
        {item.icon}
      </span>
      <span className={collapsed ? "lg:hidden" : ""}>{item.label}</span>
    </Link>
  );
}

function NavSection({
  title,
  items,
  onNavigate,
  collapsed,
  first,
}: {
  title: string;
  items: NavItem[];
  onNavigate?: () => void;
  collapsed?: boolean;
  first?: boolean;
}) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  // When the sidebar is in icon-only mode the section headers are hidden, so
  // always show the icons regardless of the per-section open state.
  const showItems = collapsed || open;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between rounded-lg px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition hover:text-slate-600 ${
          first ? "pt-2" : "pt-4"
        } ${collapsed ? "lg:hidden" : ""}`}
      >
        <span>{title}</span>
        <span
          aria-hidden
          className={`text-xs transition-transform ${open ? "" : "-rotate-90"}`}
        >
          ⌄
        </span>
      </button>
      {showItems
        ? items.map((m) => (
            <NavLink
              key={m.href}
              item={m}
              onNavigate={onNavigate}
              collapsed={collapsed}
            />
          ))
        : null}
    </>
  );
}

function NavLinks({
  allowed,
  onNavigate,
  collapsed,
}: {
  allowed: Set<ModuleKey>;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  return (
    <>
      <NavSection
        title="Modules"
        items={MODULES_TOP.filter((m) => allowed.has(m.key))}
        onNavigate={onNavigate}
        collapsed={collapsed}
        first
      />
      <NavSection
        title="HR / Recruit / GDU"
        items={HR_RECRUIT.filter((m) => allowed.has(m.key))}
        onNavigate={onNavigate}
        collapsed={collapsed}
      />
      <NavSection
        title="Marketing"
        items={MARKETING.filter((m) => allowed.has(m.key))}
        onNavigate={onNavigate}
        collapsed={collapsed}
      />
      <NavSection
        title="Operations"
        items={MODULES_BOTTOM.filter((m) => allowed.has(m.key))}
        onNavigate={onNavigate}
        collapsed={collapsed}
      />
      <NavSection
        title="Biz Dev"
        items={BIZ_DEV.filter((m) => allowed.has(m.key))}
        onNavigate={onNavigate}
        collapsed={collapsed}
      />
    </>
  );
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-base font-bold text-white shadow-sm shadow-emerald-600/30">
        🐾
      </span>
      <span
        className={`flex flex-col leading-tight ${collapsed ? "lg:hidden" : ""}`}
      >
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

function UserFooter({
  email,
  role,
  collapsed,
}: {
  email: string | null;
  role: AppRole;
  collapsed?: boolean;
}) {
  return (
    <div className="border-t border-slate-200/80 p-3">
      <div
        className={`mb-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${
          collapsed ? "lg:justify-center lg:px-0" : ""
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold uppercase text-slate-500">
          {(email ?? "?").charAt(0)}
        </span>
        <div className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>
          <p
            className="truncate text-xs text-slate-500"
            title={email ?? ""}
          >
            {email}
          </p>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
            {ROLE_LABELS[role]}
          </span>
        </div>
      </div>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          title={collapsed ? "Sign out" : undefined}
          className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 ${
            collapsed ? "lg:px-0" : ""
          }`}
        >
          <span className={collapsed ? "lg:hidden" : ""}>Sign out</span>
          <span className={collapsed ? "hidden lg:inline" : "hidden"} aria-hidden>
            ⏻
          </span>
        </button>
      </form>
    </div>
  );
}

export function AppShell({
  email,
  role,
  modules,
  children,
}: {
  email: string | null;
  role: AppRole;
  modules: ModuleKey[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    getSidebarCollapsed,
    () => false,
  );
  const allowed = new Set<ModuleKey>(modules);

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
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[82vw] shrink-0 flex-col border-r border-slate-200/80 bg-white shadow-xl transition-all duration-300 ease-out lg:relative lg:z-auto lg:max-w-none lg:translate-x-0 lg:bg-white/80 lg:shadow-none lg:backdrop-blur-sm ${
          collapsed ? "lg:w-20" : "lg:w-64"
        } ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Desktop collapse / expand toggle — pinned to the right border */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          className="absolute right-0 top-20 z-10 hidden h-7 w-7 translate-x-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-emerald-300 hover:text-emerald-600 lg:flex"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${collapsed ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div
          className={`flex items-center justify-between border-b border-slate-200/80 px-5 py-4 ${
            collapsed ? "lg:px-3" : ""
          }`}
        >
          <Brand collapsed={collapsed} />
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
          <NavLinks
            allowed={allowed}
            onNavigate={() => setOpen(false)}
            collapsed={collapsed}
          />
        </nav>

        <UserFooter email={email} role={role} collapsed={collapsed} />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-x-hidden px-4 pb-10 pt-[4.5rem] sm:px-6 lg:px-10 lg:pb-10 lg:pt-8">
        {children}
      </main>
    </div>
  );
}
