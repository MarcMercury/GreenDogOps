"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/auth/permissions";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { ViewAsUserOption } from "@/lib/auth/view-as";

export interface ViewAsState {
  kind: "user" | "role";
  label: string;
  email: string | null;
  role: AppRole;
}

type Loaded = { users: ViewAsUserOption[]; roles: AppRole[] };

const ROLE_CHIP: Record<AppRole, string> = {
  owner: "bg-emerald-50 text-emerald-700",
  admin: "bg-emerald-50 text-emerald-700",
  executive: "bg-sky-50 text-sky-700",
  manager: "bg-indigo-50 text-indigo-700",
  schedule_admin: "bg-violet-50 text-violet-700",
  marketing_admin: "bg-pink-50 text-pink-700",
  staff: "bg-slate-100 text-slate-600",
  employee: "bg-amber-50 text-amber-700",
};

function RoleChip({ role }: { role: AppRole }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ROLE_CHIP[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

/**
 * Posts to /api/view-as, which sets or clears the preview cookie and 303s back
 * to this page — a plain form post, so it works whatever the previewed access.
 */
function SwitchForm({
  target,
  className,
  title,
  children,
}: {
  target: string;
  className: string;
  title?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <form method="post" action="/api/view-as">
      <input type="hidden" name="target" value={target} />
      <input type="hidden" name="returnTo" value={pathname || "/"} />
      <button type="submit" className={className} title={title}>
        {children}
      </button>
    </form>
  );
}

/** "Switch back to me" — always available while previewing. */
export function SwitchBackButton({ compact }: { compact?: boolean }) {
  return (
    <SwitchForm
      target="self"
      title="Switch back to your own view"
      className={
        compact
          ? "rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-700"
          : "w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700"
      }
    >
      ↩ Switch back to me
    </SwitchForm>
  );
}

/** Top-of-page reminder that this is someone else's (read-only) view. */
export function ViewAsBanner({ viewAs }: { viewAs: ViewAsState }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <span aria-hidden>👁</span>
      <span className="min-w-0 flex-1">
        Viewing as <strong>{viewAs.label}</strong>
        {viewAs.kind === "user" ? <> · {ROLE_LABELS[viewAs.role]}</> : null}
        <span className="block text-xs text-amber-800/80">
          Read-only preview of their menus, pages, and permissions. Changes are
          disabled. Some lists still use your own database access and may show
          records they can&apos;t see.
        </span>
      </span>
      <SwitchBackButton compact />
    </div>
  );
}

/**
 * Sidebar-footer control for Owners: pick any active user (or a role's
 * defaults) to preview their access, and switch back at any time.
 */
export function ViewAsSwitcher({
  viewAs,
  collapsed,
  onExpand,
}: {
  viewAs: ViewAsState | null;
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const load = () => {
    setError(null);
    fetch("/api/view-as", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setData({ users: body.users, roles: body.roles });
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Could not load users."),
      );
  };

  const toggle = () => {
    if (collapsed) onExpand?.();
    const next = !open;
    setOpen(next);
    if (next && !data) load();
  };

  const q = query.trim().toLowerCase();
  const users = useMemo(() => {
    if (!data) return [];
    if (!q) return data.users;
    return data.users.filter((u) =>
      [u.full_name, u.email, u.title, ROLE_LABELS[u.role]]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [data, q]);
  const roles = useMemo(() => {
    if (!data) return [];
    if (!q) return data.roles;
    return data.roles.filter((r) => ROLE_LABELS[r].toLowerCase().includes(q));
  }, [data, q]);

  const itemClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-800";

  return (
    <div ref={wrapRef} className="relative mb-2">
      {viewAs ? (
        <div className={`mb-2 rounded-lg border border-amber-300 bg-amber-50 p-2 ${collapsed ? "lg:hidden" : ""}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
            Viewing as
          </p>
          <p className="truncate text-xs font-medium text-amber-900" title={viewAs.email ?? viewAs.label}>
            {viewAs.label}
          </p>
          {viewAs.kind === "user" ? <RoleChip role={viewAs.role} /> : null}
          <div className="mt-2">
            <SwitchBackButton />
          </div>
        </div>
      ) : null}

      {viewAs && collapsed ? (
        <div className="mb-2 hidden lg:block">
          <SwitchForm
            target="self"
            title={`Viewing as ${viewAs.label} — switch back to me`}
            className="flex w-full items-center justify-center rounded-lg bg-amber-600 py-2 text-sm text-white hover:bg-amber-700"
          >
            ↩
          </SwitchForm>
        </div>
      ) : null}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={collapsed ? "View as another user" : undefined}
        className={`flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-emerald-400 hover:text-emerald-700 ${
          collapsed ? "lg:justify-center lg:px-0" : ""
        }`}
      >
        <span aria-hidden>👁</span>
        <span className={collapsed ? "lg:hidden" : ""}>
          {viewAs ? "View as someone else…" : "View as…"}
        </span>
        <span aria-hidden className={`ml-auto text-[10px] ${collapsed ? "lg:hidden" : ""}`}>
          {open ? "▾" : "▴"}
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="View as another user"
          className="absolute bottom-full left-0 z-50 mb-2 flex max-h-[70vh] w-full min-w-[16rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="border-b border-slate-100 p-2">
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, or role"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-emerald-400"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-1">
            {viewAs ? (
              <SwitchForm target="self" className={`${itemClass} font-semibold text-amber-800`}>
                ↩ Me (my own access)
              </SwitchForm>
            ) : null}
            {error ? (
              <p className="px-2 py-2 text-xs text-red-600">
                {error}{" "}
                <button type="button" onClick={load} className="underline">
                  Retry
                </button>
              </p>
            ) : !data ? (
              <p className="px-2 py-2 text-xs text-slate-400">Loading users…</p>
            ) : (
              <>
                {roles.length > 0 ? (
                  <>
                    <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Access groups (role defaults)
                    </p>
                    {roles.map((r) => (
                      <SwitchForm key={r} target={`role:${r}`} className={itemClass}>
                        <RoleChip role={r} />
                        <span className="truncate text-slate-500">default access</span>
                      </SwitchForm>
                    ))}
                  </>
                ) : null}
                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Users ({users.length})
                </p>
                {users.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-slate-400">No matching users.</p>
                ) : (
                  users.map((u) => (
                    <SwitchForm
                      key={u.id}
                      target={`user:${u.id}`}
                      title={u.email}
                      className={itemClass}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {u.full_name || u.email}
                        </span>
                        {u.full_name ? (
                          <span className="block truncate text-[10px] text-slate-400">
                            {u.email}
                          </span>
                        ) : null}
                      </span>
                      <RoleChip role={u.role} />
                    </SwitchForm>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
