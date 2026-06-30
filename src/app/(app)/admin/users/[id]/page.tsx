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
import {
  updateUser,
  revokeAccess,
  linkUserToPerson,
  resetUserPassword,
} from "../../actions";

export const dynamic = "force-dynamic";

const ROSTER_BANNERS: Record<string, { tone: "ok" | "error"; text: string }> = {
  linked: { tone: "ok", text: "Linked to roster profile and synced name + title." },
  unlinked: { tone: "ok", text: "Roster profile unlinked." },
  conflict: {
    tone: "error",
    text: "That roster profile is already linked to another login.",
  },
  notfound: { tone: "error", text: "Roster profile not found." },
};

const PW_BANNERS: Record<string, { tone: "ok" | "error"; text: string }> = {
  ok: { tone: "ok", text: "Password updated. Share it with the user securely." },
  short: { tone: "error", text: "Password must be at least 8 characters." },
  error: { tone: "error", text: "Could not update the password. Try again." },
};

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pw?: string; roster?: string }>;
}) {
  const { id } = await params;
  const { pw, roster } = await searchParams;
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_user")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const user = data as AppUser | null;
  if (!user) notFound();

  // The roster person this login account is linked to, if any.
  let linkedPerson: { id: string; name: string; title: string | null } | null =
    null;
  if (user.person_id) {
    const [{ data: personRow }, { data: empRow }] = await Promise.all([
      admin
        .from("person")
        .select("id, full_name, first_name, last_name")
        .eq("id", user.person_id)
        .maybeSingle(),
      admin
        .from("person_employment")
        .select("adp_job_title, offer_title")
        .eq("person_id", user.person_id)
        .maybeSingle(),
    ]);
    if (personRow) {
      const p = personRow as {
        id: string;
        full_name: string | null;
        first_name: string | null;
        last_name: string | null;
      };
      const emp = empRow as {
        adp_job_title: string | null;
        offer_title: string | null;
      } | null;
      linkedPerson = {
        id: p.id,
        name:
          p.full_name ||
          [p.first_name, p.last_name].filter(Boolean).join(" ") ||
          "Roster profile",
        title: emp?.adp_job_title ?? emp?.offer_title ?? null,
      };
    }
  }

  // All roster profiles, for the link/match picker.
  const { data: peopleData } = await admin
    .from("person")
    .select("id, full_name, first_name, last_name, email, status")
    .order("last_name", { ascending: true });
  const people = (peopleData ?? []) as Array<{
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    status: string;
  }>;
  const personOption = (p: (typeof people)[number]): string => {
    const name =
      p.full_name ||
      [p.first_name, p.last_name].filter(Boolean).join(" ") ||
      "Unnamed";
    const bits = [name];
    if (p.email) bits.push(p.email);
    bits.push(p.status);
    return bits.join(" · ");
  };

  const rosterBanner = roster ? ROSTER_BANNERS[roster] : undefined;
  const pwBanner = pw ? PW_BANNERS[pw] : undefined;

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

      {rosterBanner ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            rosterBanner.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {rosterBanner.text}
        </div>
      ) : null}
      {pwBanner ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            pwBanner.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {pwBanner.text}
        </div>
      ) : null}

      <form action={updateUser} className="space-y-6">
        <input type="hidden" name="id" value={user.id} />

        <Panel
          title={user.full_name ?? user.email}
          description={user.email}
        >
          {linkedPerson ? (
            <p className="mb-4 text-sm text-slate-500">
              Linked roster profile:{" "}
              <Link
                href={`/hr/${linkedPerson.id}`}
                className="font-medium text-emerald-600 hover:text-emerald-700"
              >
                {linkedPerson.name} →
              </Link>
              {linkedPerson.title ? (
                <span className="text-slate-400"> · {linkedPerson.title}</span>
              ) : null}
            </p>
          ) : (
            <p className="mb-4 text-sm text-amber-600">
              ⚠ Not linked to a roster profile. Link one below so the name and
              title stay in sync.
            </p>
          )}
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
        title="Roster profile"
        description="Match this login to its Employee / HR roster record. The name and title are pulled from the roster on link."
      >
        <form action={linkUserToPerson} className="space-y-3">
          <input type="hidden" name="id" value={user.id} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Roster profile
            </span>
            <select
              name="person_id"
              defaultValue={user.person_id ?? ""}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            >
              <option value="">— Not linked —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {personOption(p)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              Link &amp; sync
            </button>
          </div>
        </form>
      </Panel>

      <Panel
        title="Password"
        description="Set a new password for this account. Share it with the user over a secure channel; they can change it after signing in."
      >
        <form action={resetUserPassword} className="space-y-3">
          <input type="hidden" name="id" value={user.id} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              New password
            </span>
            <input
              type="password"
              name="password"
              minLength={8}
              required
              autoComplete="new-password"
              placeholder="At least 8 characters"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50"
            >
              Reset password
            </button>
          </div>
        </form>
      </Panel>

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
