import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <span className="text-lg font-semibold text-emerald-700">
            Green Dog Ops
          </span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {MODULES.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700"
            >
              <span aria-hidden>{m.icon}</span>
              {m.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <p className="mb-2 truncate px-1 text-xs text-slate-500" title={user.email ?? ""}>
            {user.email}
          </p>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
