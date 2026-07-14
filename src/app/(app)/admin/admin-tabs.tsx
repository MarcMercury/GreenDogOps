"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/locations", label: "Locations" },
  { href: "/admin/credentials", label: "Credentials" },
  { href: "/admin/agents", label: "Agents" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200">
      {TABS.map((t) => {
        const active =
          t.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`relative -mb-px rounded-t-lg px-3.5 py-2 text-sm font-medium transition ${
              active
                ? "border-b-2 border-emerald-600 text-emerald-700"
                : "border-b-2 border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
