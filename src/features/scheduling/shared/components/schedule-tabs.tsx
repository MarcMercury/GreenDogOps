"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Tab strip across the top of every `/schedule/*` page. Interim navigation:
 * each tab is slated to become a Scheduling item in the sidebar, at which point
 * this component goes away and the layout stops rendering it.
 */
const TABS = [
  { href: "/schedule", label: "Grid", icon: "▦" },
  { href: "/schedule/attendance", label: "Attendance", icon: "✓" },
  { href: "/schedule/time-attendance", label: "Time & Attendance", icon: "◷" },
  { href: "/schedule/time-clock", label: "Time Clock", icon: "⏱" },
  { href: "/schedule/payroll", label: "Payroll", icon: "$" },
  { href: "/schedule/setup", label: "Set Up", icon: "⚙" },
];

export function ScheduleTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200 print:hidden">
      {TABS.map((t) => {
        const active =
          t.href === "/schedule"
            ? pathname === "/schedule"
            : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`relative -mb-px flex items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-sm font-medium transition ${
              active
                ? "border-b-2 border-emerald-600 text-emerald-700"
                : "border-b-2 border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <span aria-hidden>{t.icon}</span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
