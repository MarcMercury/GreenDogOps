import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  APP_ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  MODULES,
  roleDefaultModules,
  type AppRole,
  type AppUser,
} from "@/lib/auth/permissions";
import { Panel } from "../../_components";
import { updateUser, revokeAccess } from "../../actions";

export const dynamic = "force-dynamic";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_user")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const user = data as AppUser | null;
  if (!user) notFound();

  const defaultsByRole = Object.fromEntries(
    APP_ROLES.map((r) => [r, new Set(roleDefaultModules(r))]),
  ) as Record<AppRole, Set<string>>;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/users"
        className="inline-flex text-sm text-slate-500 hover:text-slate-800"
      >
        ← All users
      </Link>

      <form action={updateUser} className="space-y-6">
        <input type="hidden" name="id" value={user.id} />

        <Panel
          title={user.full_name ?? user.email}
          description={user.email}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Full name
              </span>
              <input
                name="full_name"
                defaultValue={user.full_name ?? ""}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Title
              </span>
              <input
                name="title"
                defaultValue={user.title ?? ""}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Role
              </span>
              <select
                name="role"
                defaultValue={user.role}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              >
                {APP_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]} — {ROLE_DESCRIPTIONS[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2.5 pt-6">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={user.is_active}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-400"
              />
              <span className="text-sm text-slate-700">
                Active (can sign in to GDO)
              </span>
            </label>
          </div>
        </Panel>

        <Panel
          title="Module access"
          description="Inherit follows the role's defaults. Allow / Deny overrides per user."
        >
          <div className="space-y-1">
            {MODULES.map((m) => {
              const override = user.module_access?.[m.key];
              const current =
                override === true
                  ? "allow"
                  : override === false
                    ? "deny"
                    : "inherit";
              const roleDefault = defaultsByRole[user.role].has(m.key);
              return (
                <div
                  key={m.key}
                  className="flex items-center justify-between border-b border-slate-50 py-2 last:border-0"
                >
                  <div>
                    <p className="text-sm text-slate-700">{m.label}</p>
                    <p className="text-xs text-slate-400">
                      role default: {roleDefault ? "allowed" : "hidden"}
                    </p>
                  </div>
                  <select
                    name={`module_${m.key}`}
                    defaultValue={current}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="inherit">Inherit</option>
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                  </select>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Notes" description="Internal notes about this user.">
          <textarea
            name="notes"
            rows={3}
            defaultValue={user.notes ?? ""}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
        </Panel>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            Save changes
          </button>
        </div>
      </form>

      <Panel
        title="Danger zone"
        description="Revoke access. The record and audit trail are kept."
      >
        <form action={revokeAccess}>
          <input type="hidden" name="id" value={user.id} />
          <button
            type="submit"
            disabled={!user.is_active}
            className="rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {user.is_active ? "Revoke access" : "Access already revoked"}
          </button>
        </form>
      </Panel>
    </div>
  );
}
