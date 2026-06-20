import Link from "next/link";
import { ROLE_LABELS, type AppRole } from "@/lib/auth/permissions";

/** A small labelled metric card for the admin dashboard. */
export function StatCard({
  label,
  value,
  sublabel,
  icon,
  href,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: string;
  href?: string;
}) {
  const body = (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-slate-300">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
          {label}
        </p>
        {icon ? <span className="text-base">{icon}</span> : null}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
        {value}
      </p>
      {sublabel ? (
        <p className="mt-0.5 text-xs text-slate-400">{sublabel}</p>
      ) : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/** A card section with a title for grouping admin content. */
export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-slate-500">{description}</p>
          ) : null}
        </div>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Status dot + label for health checks. */
export function StatusRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean | null;
  detail?: string;
}) {
  const color =
    ok === null ? "bg-slate-300" : ok ? "bg-emerald-500" : "bg-rose-500";
  return (
    <div className="flex items-center justify-between border-b border-slate-50 py-2 last:border-0">
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
        <span className="text-sm text-slate-700">{label}</span>
      </div>
      {detail ? (
        <span className="text-xs text-slate-400">{detail}</span>
      ) : null}
    </div>
  );
}

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-purple-50 text-purple-700 ring-purple-200",
  admin: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  manager: "bg-blue-50 text-blue-700 ring-blue-200",
  schedule_admin: "bg-amber-50 text-amber-700 ring-amber-200",
  staff: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_BADGE[role] ?? ROLE_BADGE.staff;
  const label = ROLE_LABELS[role as AppRole] ?? role;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${cls}`}
    >
      {label}
    </span>
  );
}
