import { createAdminClient } from "@/lib/supabase/admin";
import {
  APP_ROLES,
  ROLE_LABELS,
  type AppRole,
  type AppUser,
} from "@/lib/auth/permissions";
import { Panel } from "../_components";
import { grantAccess, autoMatchUsersToRoster } from "../actions";
import { UsersTable, type UserRow } from "./users-table";

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ match?: string }>;
}) {
  const { match } = await searchParams;
  const admin = createAdminClient();

  const [{ data: appUsersData }, { data: authList }] = await Promise.all([
    admin
      .from("app_user")
      .select("*")
      .order("is_active", { ascending: false })
      .order("role"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const appUsers = (appUsersData ?? []) as AppUser[];
  const grantedIds = new Set(appUsers.map((u) => u.id));

  // Load the roster profiles linked to these logins, so we can show the
  // matched employee name/title and flag any user without a roster profile.
  const personIds = appUsers
    .map((u) => u.person_id)
    .filter((p): p is string => Boolean(p));
  const rosterById = new Map<
    string,
    { name: string; title: string | null }
  >();
  if (personIds.length > 0) {
    const [{ data: persons }, { data: employments }] = await Promise.all([
      admin
        .from("person")
        .select("id, full_name, first_name, last_name")
        .in("id", personIds),
      admin
        .from("person_employment")
        .select("person_id, adp_job_title, offer_title")
        .in("person_id", personIds),
    ]);
    const titleById = new Map<string, string | null>();
    for (const e of (employments ?? []) as Array<{
      person_id: string;
      adp_job_title: string | null;
      offer_title: string | null;
    }>) {
      titleById.set(e.person_id, e.adp_job_title ?? e.offer_title ?? null);
    }
    for (const p of (persons ?? []) as Array<{
      id: string;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>) {
      rosterById.set(p.id, {
        name:
          p.full_name ||
          [p.first_name, p.last_name].filter(Boolean).join(" ") ||
          "Roster profile",
        title: titleById.get(p.id) ?? null,
      });
    }
  }

  const unlinkedCount = appUsers.filter((u) => !u.person_id).length;

  const userRows: UserRow[] = appUsers.map((u) => {
    const roster = u.person_id ? rosterById.get(u.person_id) : null;
    return {
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      person_id: u.person_id,
      rosterName: roster?.name ?? null,
      rosterTitle: roster?.title ?? null,
      role: u.role,
      is_active: u.is_active,
      last_seen_at: u.last_seen_at,
    };
  });

  // Auth users (shared with the sibling app) who don't yet have GDO access.
  const pending = (authList?.users ?? [])
    .filter((u) => u.email && !grantedIds.has(u.id))
    .map((u) => ({ id: u.id, email: u.email as string }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return (
    <div className="space-y-6">
      {match !== undefined ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Auto-matched {match} login(s) to a roster profile by email.
        </div>
      ) : null}

      <Panel
        title="Green Dog Ops users"
        description={`${appUsers.filter((u) => u.is_active).length} active · ${appUsers.length} total`}
        actions={
          unlinkedCount > 0 ? (
            <form action={autoMatchUsersToRoster}>
              <button
                type="submit"
                className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50"
              >
                Auto-match {unlinkedCount} by email
              </button>
            </form>
          ) : null
        }
      >
        <UsersTable users={userRows} />
      </Panel>

      <Panel
        title="Grant access"
        description={`${pending.length} authenticated account(s) don't have Green Dog Ops access yet.`}
      >
        {pending.length === 0 ? (
          <p className="text-sm text-slate-400">
            Everyone with an account already has access.
          </p>
        ) : (
          <form
            action={grantAccess}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex-1 min-w-[220px]">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Account
              </span>
              <select
                name="auth_id"
                required
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              >
                {pending.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Role
              </span>
              <select
                name="role"
                defaultValue="staff"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              >
                {APP_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r as AppRole]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              Grant access
            </button>
          </form>
        )}
      </Panel>
    </div>
  );
}
