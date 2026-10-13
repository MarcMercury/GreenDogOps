"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/me", label: "Clock" },
  { href: "/me/schedule", label: "My Schedule" },
  { href: "/me/timecard", label: "Timecard" },
  { href: "/me/waivers", label: "Meal waivers" },
  { href: "/me/privacy", label: "Privacy" },
];

export function MeTabs() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
      {TABS.map((t) => {
        const active = t.href === "/me" ? pathname === "/me" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`relative -mb-px shrink-0 rounded-t-lg px-3.5 py-2 text-sm font-medium transition ${
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
